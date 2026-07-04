import pyarrow as pa
from deltalake import write_deltalake
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.main import app
from app.models.bi import SemanticDataset, SemanticMetric
from app.models.catalog import DeltaTable


def test_metric_alert_can_be_created_evaluated_and_listed() -> None:
    settings = get_settings()
    table_path = settings.curated_storage_path + "/metric_alert_orders"
    write_deltalake(
        table_path,
        pa.table(
            {
                "region": ["EMEA", "AMER", "EMEA"],
                "status": ["completed", "completed", "cancelled"],
                "revenue": [120.0, 90.0, 30.0],
            }
        ),
        mode="overwrite",
    )

    with TestClient(app) as client:
        db = SessionLocal()
        try:
            table = DeltaTable(
                name="metric_alert_orders",
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
                name="metric_alert_orders_dataset",
                source_type="delta_table",
                source_ref=table.name,
                schema_json=table.schema_json,
                metrics_json=[{"name": "revenue_sum", "expression": 'SUM("revenue")'}],
                dimensions_json=[{"name": "region"}, {"name": "status"}],
            )
            db.add(dataset)
            db.flush()
            metric = SemanticMetric(
                name="metric_alert_completed_revenue",
                label="Completed Revenue",
                dataset_id=dataset.id,
                expression='SUM("revenue")',
                filter_sql="status = 'completed'",
                dimensions_json=["region"],
                format="currency",
                is_certified=True,
            )
            db.add(metric)
            db.commit()
            metric_id = metric.id
        finally:
            db.close()

        login = client.post(
            "/api/system/login",
            json={"email": "admin@datawizz.local", "password": "datawizz123"},
        )
        token = login.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        created = client.post(
            "/api/bi/alerts",
            headers=headers,
            json={
                "name": "completed_revenue_alert",
                "metric_id": metric_id,
                "comparison": "gt",
                "threshold_value": 200,
                "severity": "critical",
                "enabled": True,
                "notification_channel": "local",
            },
        )
        assert created.status_code == 200
        alert = created.json()
        assert alert["metric_label"] == "Completed Revenue"
        assert alert["last_status"] == "not_evaluated"

        evaluated = client.post(f"/api/bi/alerts/{alert['id']}/evaluate", headers=headers)
        assert evaluated.status_code == 200
        result = evaluated.json()
        assert result["alert"]["last_status"] == "triggered"
        assert result["alert"]["last_value"] == 210.0
        assert result["event"]["triggered"] is True
        assert result["event"]["observed_value"] == 210.0

        events = client.get("/api/bi/alerts/events", headers=headers)
        assert events.status_code == 200
        assert events.json()["items"][0]["alert_name"] == "completed_revenue_alert"

        sweep = client.post("/api/bi/alerts/evaluate-all", headers=headers)
        assert sweep.status_code == 200
        assert sweep.json()["checked"] >= 1
        assert sweep.json()["triggered"] >= 1
