from pathlib import Path

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.catalog import UploadedFile
from app.models.pipeline import Pipeline
from app.services import pipeline_service as pipeline_service_module


def test_invalid_pipeline_emits_start_and_fail(monkeypatch) -> None:
    emitted: list[dict] = []
    monkeypatch.setattr(
        pipeline_service_module.openlineage_service,
        "emit",
        lambda **payload: emitted.append(payload),
    )

    db = SessionLocal()
    try:
        pipeline = Pipeline(
            name="Invalid lineage pipeline",
            status="draft",
            definition_json={
                "nodes": [
                    {
                        "id": "write_1",
                        "type": "writeDelta",
                        "data": {"config": {"tableName": "lineage_output"}},
                    }
                ],
                "edges": [],
            },
        )
        db.add(pipeline)
        db.commit()
        db.refresh(pipeline)

        run = pipeline_service_module.PipelineService().execute_pipeline(db, pipeline)

        assert run.status == "failed"
        assert [event["event_type"] for event in emitted] == ["START", "FAIL"]
        assert emitted[0]["run_id"] == run.id
        assert emitted[1]["run_facets"]["datawizz"]["status"] == "failed"
    finally:
        db.close()


def test_successful_pipeline_emits_dataset_inputs_and_outputs(monkeypatch) -> None:
    emitted: list[dict] = []
    monkeypatch.setattr(
        pipeline_service_module.openlineage_service,
        "emit",
        lambda **payload: emitted.append(payload),
    )
    settings = get_settings()
    source_path = Path(settings.raw_storage_path) / "lineage_orders.csv"
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_text("order_id,total\n1,10\n2,20\n", encoding="utf-8")

    db = SessionLocal()
    try:
        uploaded_file = UploadedFile(
            name="lineage_orders.csv",
            storage_path=str(source_path),
            file_type="csv",
            size_bytes=source_path.stat().st_size,
            schema_json=[
                {"name": "order_id", "type": "int64"},
                {"name": "total", "type": "int64"},
            ],
            row_count=2,
        )
        db.add(uploaded_file)
        db.commit()
        db.refresh(uploaded_file)
        pipeline = Pipeline(
            name="Successful lineage pipeline",
            status="draft",
            definition_json={
                "nodes": [
                    {
                        "id": "source_1",
                        "type": "fileSource",
                        "data": {"config": {"fileId": uploaded_file.id}},
                    },
                    {
                        "id": "write_1",
                        "type": "writeDelta",
                        "data": {
                            "config": {
                                "tableName": "lineage_orders_curated",
                                "schemaName": "analytics",
                                "mode": "overwrite",
                            }
                        },
                    },
                ],
                "edges": [{"id": "edge_1", "source": "source_1", "target": "write_1"}],
            },
        )
        db.add(pipeline)
        db.commit()
        db.refresh(pipeline)

        run = pipeline_service_module.PipelineService().execute_pipeline(db, pipeline)

        assert run.status == "success"
        assert [event["event_type"] for event in emitted] == ["START", "COMPLETE"]
        assert emitted[0]["inputs"][0]["name"] == str(source_path)
        assert emitted[1]["outputs"][0]["namespace"] == "datawizz://delta/analytics"
        assert emitted[1]["outputs"][0]["name"] == "lineage_orders_curated"
    finally:
        db.close()
