from datetime import datetime, timedelta, timezone
from pathlib import Path

import pyarrow as pa
from deltalake import write_deltalake

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.catalog import DeltaTable, QualityRun, UploadedFile
from app.models.pipeline import Pipeline
from app.services.catalog_metadata_service import CatalogMetadataService
from app.services.pipeline_service import PipelineService
from app.services.quality_scheduler_service import QualitySchedulerService


def _quality_table(db, name: str, rows: dict) -> DeltaTable:
    settings = get_settings()
    table_path = Path(settings.curated_storage_path) / name
    write_deltalake(str(table_path), pa.table(rows), mode="overwrite")
    table = DeltaTable(
        name=name,
        schema_name="analytics",
        storage_path=str(table_path),
        mode="overwrite",
        schema_json=[{"name": field.name, "type": str(field.type)} for field in pa.table(rows).schema],
        row_count=len(next(iter(rows.values()))),
    )
    db.add(table)
    db.commit()
    db.refresh(table)
    return table


def test_blocking_pipeline_quality_gate_stops_run_and_persists_evidence() -> None:
    settings = get_settings()
    source_path = Path(settings.raw_storage_path) / "quality_gate_orders.csv"
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_text("order_id,status\n1,complete\n2,\n", encoding="utf-8")

    db = SessionLocal()
    try:
        table = _quality_table(db, "quality_gate_orders", {"order_id": [0], "status": ["seed"]})
        CatalogMetadataService().update_quality_suite(
            table,
            name="Orders quality gate",
            expectations=[
                {
                    "id": "status-required",
                    "expectation_type": "not_null",
                    "enabled": True,
                    "severity": "error",
                    "column": "status",
                    "min_value": None,
                    "max_value": None,
                    "accepted_values": None,
                }
            ],
        )
        source = UploadedFile(
            name=source_path.name,
            storage_path=str(source_path),
            file_type="csv",
            size_bytes=source_path.stat().st_size,
            schema_json=[
                {"name": "order_id", "type": "int64"},
                {"name": "status", "type": "string"},
            ],
            row_count=2,
        )
        db.add(source)
        db.commit()
        db.refresh(source)
        pipeline = Pipeline(
            name="Blocking quality gate pipeline",
            status="draft",
            definition_json={
                "nodes": [
                    {"id": "source", "type": "fileSource", "data": {"config": {"fileId": source.id}}},
                    {
                        "id": "write",
                        "type": "writeDelta",
                        "data": {
                            "config": {
                                "tableName": table.name,
                                "schemaName": "analytics",
                                "mode": "overwrite",
                                "qualityGate": "block",
                            }
                        },
                    },
                ],
                "edges": [{"id": "edge", "source": "source", "target": "write"}],
            },
        )
        db.add(pipeline)
        db.commit()
        db.refresh(pipeline)

        pipeline_run = PipelineService().execute_pipeline(db, pipeline)

        quality_run = (
            db.query(QualityRun)
            .filter(QualityRun.pipeline_run_id == pipeline_run.id)
            .one()
        )
        assert pipeline_run.status == "failed"
        assert "Quality gate blocked downstream execution" in (pipeline_run.error_message or "")
        assert quality_run.trigger_type == "pipeline_gate"
        assert quality_run.status == "failed"
        assert quality_run.failed_count == 1
        assert pipeline_run.run_summary["quality_runs"][0]["quality_run_id"] == quality_run.id
    finally:
        db.close()


def test_quality_scheduler_creates_scheduled_history(monkeypatch) -> None:
    db = SessionLocal()
    try:
        table = _quality_table(db, "scheduled_quality_orders", {"order_id": [1, 2]})
        metadata = CatalogMetadataService()
        metadata.update_quality_schedule(table, cron="* * * * *", enabled=True)
        table_id = table.id
    finally:
        db.close()

    scheduler = QualitySchedulerService()
    monkeypatch.setattr(
        scheduler,
        "compute_next_run_at",
        lambda table, last_run: datetime.now(timezone.utc) - timedelta(seconds=1),
    )
    result = scheduler.run_due_once()

    db = SessionLocal()
    try:
        run = (
            db.query(QualityRun)
            .filter(QualityRun.table_id == table_id)
            .filter(QualityRun.trigger_type == "scheduled")
            .one()
        )
        triggered = next(item for item in result["triggered"] if item["table_id"] == table_id)
        assert triggered["quality_run_id"] == run.id
        assert run.status == "passed"
    finally:
        db.close()
