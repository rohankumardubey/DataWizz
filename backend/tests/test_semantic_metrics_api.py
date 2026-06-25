import pyarrow as pa
from deltalake import write_deltalake
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.main import app
from app.models.bi import SemanticDataset
from app.models.catalog import DeltaTable


def test_semantic_metric_can_be_created_and_previewed() -> None:
    settings = get_settings()
    table_path = settings.curated_storage_path + "/metric_api_orders"
    write_deltalake(
        table_path,
        pa.table(
            {
                "region": ["EMEA", "EMEA", "AMER"],
                "status": ["completed", "cancelled", "completed"],
                "revenue": [100.0, 25.0, 70.0],
            }
        ),
        mode="overwrite",
    )

    with TestClient(app) as client:
        db = SessionLocal()
        try:
            table = DeltaTable(
                name="metric_api_orders",
                schema_name="analytics",
                storage_path=table_path,
                mode="overwrite",
                schema_json=[
                    {"name": "region", "type": "string"},
                    {"name": "status", "type": "string"},
                    {"name": "revenue", "type": "double"},
                ],
                row_count=3,
            )
            db.add(table)
            db.flush()
            dataset = SemanticDataset(
                name="metric_api_orders_dataset",
                source_type="delta_table",
                source_ref=table.name,
                schema_json=table.schema_json,
                metrics_json=[{"name": "revenue_sum", "expression": 'SUM("revenue")'}],
                dimensions_json=[{"name": "region"}, {"name": "status"}],
            )
            db.add(dataset)
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

        created = client.post(
            "/api/bi/metrics",
            headers=headers,
            json={
                "name": "total_completed_revenue",
                "label": "Total Completed Revenue",
                "dataset_id": dataset_id,
                "expression": 'SUM("revenue")',
                "filter_sql": "status = 'completed'",
                "dimensions_json": ["region"],
                "format": "currency",
                "is_certified": True,
            },
        )
        assert created.status_code == 200
        metric = created.json()
        assert metric["dataset_name"] == "metric_api_orders_dataset"
        assert metric["is_certified"] is True

        preview = client.post(
            f"/api/bi/metrics/{metric['id']}/preview",
            headers=headers,
            json={"dimensions": ["region"], "limit": 10},
        )
        assert preview.status_code == 200
        payload = preview.json()
        assert payload["columns"] == ["region", "metric_value"]
        assert payload["rows"] == [
            {"region": "EMEA", "metric_value": 100.0},
            {"region": "AMER", "metric_value": 70.0},
        ]
        assert "GROUP BY 1" in payload["sql"]

        blocked = client.post(
            f"/api/bi/metrics/{metric['id']}/preview",
            headers=headers,
            json={"where_sql": "DROP TABLE metric_api_orders"},
        )
        assert blocked.status_code == 400
