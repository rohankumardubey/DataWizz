import pyarrow as pa
from deltalake import write_deltalake
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.main import app
from app.models.catalog import DeltaTable


def test_quality_suite_can_be_saved_and_run_through_api() -> None:
    settings = get_settings()
    table_path = settings.curated_storage_path + "/quality_api_orders"
    write_deltalake(
        table_path,
        pa.table({"order_id": [1, 2], "customer_id": [10, 20]}),
        mode="overwrite",
    )

    with TestClient(app) as client:
        login = client.post(
            "/api/system/login",
            json={"email": "admin@datawizz.local", "password": "datawizz123"},
        )
        token = login.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        db = SessionLocal()
        try:
            table = DeltaTable(
                name="quality_api_orders",
                schema_name="analytics",
                storage_path=table_path,
                mode="overwrite",
                schema_json=[
                    {"name": "order_id", "type": "int64"},
                    {"name": "customer_id", "type": "int64"},
                ],
                row_count=2,
            )
            db.add(table)
            db.commit()
            db.refresh(table)
            table_id = table.id
        finally:
            db.close()

        saved = client.put(
            f"/api/tables/{table_id}/quality-suite",
            headers=headers,
            json={
                "name": "Orders baseline",
                "expectations": [
                    {
                        "id": "has-rows",
                        "expectation_type": "row_count_between",
                        "min_value": 1,
                        "enabled": True,
                        "severity": "error",
                    },
                    {
                        "id": "order-id-unique",
                        "expectation_type": "unique",
                        "column": "order_id",
                        "enabled": True,
                        "severity": "warning",
                    },
                ],
            },
        )
        assert saved.status_code == 200
        assert saved.json()["quality_suite_name"] == "Orders baseline"

        run = client.post(f"/api/tables/{table_id}/quality-runs", headers=headers)
        assert run.status_code == 200
        assert run.json()["status"] == "passed"
        assert run.json()["passed_count"] == 2

        history = client.get(f"/api/tables/{table_id}/quality-runs", headers=headers)
        assert history.status_code == 200
        assert history.json()["items"][0]["id"] == run.json()["id"]
        assert history.json()["items"][0]["trigger_type"] == "manual"

        schedule = client.put(
            f"/api/tables/{table_id}/quality-schedule",
            headers=headers,
            json={"cron": "0 7 * * *", "enabled": True},
        )
        assert schedule.status_code == 200
        assert schedule.json()["quality_schedule_enabled"] is True
        assert schedule.json()["quality_schedule_cron"] == "0 7 * * *"

        scheduler_status = client.get("/api/tables/quality-scheduler/status", headers=headers)
        assert scheduler_status.status_code == 200
        assert scheduler_status.json()["managed_table_count"] >= 1

        scheduler_sweep = client.post("/api/tables/quality-scheduler/run-due", headers=headers)
        assert scheduler_sweep.status_code == 200
        assert scheduler_sweep.json()["checked"] >= 1
