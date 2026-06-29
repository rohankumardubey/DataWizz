import pyarrow as pa
from deltalake import write_deltalake
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.main import app
from app.models.bi import SemanticDataset, SemanticMetric
from app.models.catalog import DeltaTable


def test_natural_language_chart_generation_creates_previewable_sql() -> None:
    settings = get_settings()
    table_path = settings.curated_storage_path + "/nl_chart_orders"
    write_deltalake(
        table_path,
        pa.table(
            {
                "region": ["EMEA", "AMER", "EMEA"],
                "order_date": ["2026-06-01", "2026-06-02", "2026-06-03"],
                "revenue": [100.0, 70.0, 120.0],
            }
        ),
        mode="overwrite",
    )

    with TestClient(app) as client:
        db = SessionLocal()
        try:
            table = DeltaTable(
                name="nl_chart_orders",
                schema_name="analytics",
                storage_path=table_path,
                mode="overwrite",
                schema_json=[
                    {"name": "region", "type": "string"},
                    {"name": "order_date", "type": "date"},
                    {"name": "revenue", "type": "double"},
                ],
                row_count=3,
            )
            db.add(table)
            db.flush()
            dataset = SemanticDataset(
                name="NL Chart Orders",
                source_type="delta_table",
                source_ref=table.name,
                schema_json=table.schema_json,
                metrics_json=[{"name": "revenue_sum", "expression": 'SUM("revenue")', "format": "currency"}],
                dimensions_json=[{"name": "region"}, {"name": "order_date"}],
            )
            db.add(dataset)
            db.flush()
            metric = SemanticMetric(
                name="total_revenue_nl_chart",
                label="Total Revenue",
                dataset_id=dataset.id,
                expression='SUM("revenue")',
                dimensions_json=["region"],
                format="currency",
                is_certified=True,
            )
            db.add(metric)
            db.commit()
            db.refresh(dataset)
            dataset_id = dataset.id
        finally:
            db.close()

        login = client.post(
            "/api/system/login",
            json={"email": "admin@datawizz.local", "password": "datawizz123"},
        )
        token = login.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        generated = client.post(
            "/api/bi/charts/generate",
            headers=headers,
            json={
                "prompt": "show revenue by region",
                "dataset_id": dataset_id,
                "limit": 10,
            },
        )
        assert generated.status_code == 200
        payload = generated.json()
        assert payload["dataset_id"] == dataset_id
        assert payload["chart_type"] == "bar"
        assert payload["config_json"]["dimensionKey"] == "region"
        assert payload["config_json"]["numberFormat"] == "currency"
        assert 'SUM("revenue")' in payload["query_sql"]
        assert '"region"' in payload["query_sql"]

        preview = client.post(
            "/api/bi/charts/preview",
            headers=headers,
            json={"sql": payload["query_sql"], "limit": 20},
        )
        assert preview.status_code == 200
        assert preview.json()["rows"] == [
            {"dimension": "EMEA", "total_revenue_nl_chart": 220.0},
            {"dimension": "AMER", "total_revenue_nl_chart": 70.0},
        ]
