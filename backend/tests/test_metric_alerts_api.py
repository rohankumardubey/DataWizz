import json
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pyarrow as pa
from deltalake import write_deltalake
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.main import app
from app.models.bi import MetricAlert, MetricAlertEvent, SemanticDataset, SemanticMetric
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
                "schedule_enabled": True,
                "schedule_cron": "* * * * *",
            },
        )
        assert created.status_code == 200
        alert = created.json()
        assert alert["metric_label"] == "Completed Revenue"
        assert alert["last_status"] == "not_evaluated"
        assert alert["schedule_enabled"] is True

        db = SessionLocal()
        try:
            saved_alert = db.query(MetricAlert).filter(MetricAlert.id == alert["id"]).one()
            saved_alert.schedule_updated_at = datetime.now(timezone.utc) - timedelta(minutes=2)
            db.commit()
        finally:
            db.close()

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

        scheduler_status = client.get("/api/bi/alerts/scheduler/status", headers=headers)
        assert scheduler_status.status_code == 200
        assert scheduler_status.json()["managed_alert_count"] >= 1

        scheduler_sweep = client.post("/api/bi/alerts/scheduler/run-due", headers=headers)
        assert scheduler_sweep.status_code == 200
        assert scheduler_sweep.json()["checked"] >= 1
        assert scheduler_sweep.json()["evaluated"][0]["alert_name"] == "completed_revenue_alert"

        db = SessionLocal()
        try:
            scheduled_event = (
                db.query(MetricAlertEvent)
                .filter(MetricAlertEvent.alert_id == alert["id"])
                .filter(MetricAlertEvent.trigger_type == "scheduled")
                .one_or_none()
            )
            assert scheduled_event is not None
            assert scheduled_event.triggered is True
        finally:
            db.close()

        sweep = client.post("/api/bi/alerts/evaluate-all", headers=headers)
        assert sweep.status_code == 200
        assert sweep.json()["checked"] >= 1
        assert sweep.json()["triggered"] >= 1


def test_triggered_metric_alert_delivers_webhook_payload() -> None:
    received_payloads: list[dict] = []

    class WebhookHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler hook name.
            content_length = int(self.headers.get("Content-Length", "0"))
            received_payloads.append(json.loads(self.rfile.read(content_length).decode("utf-8")))
            self.send_response(202)
            self.end_headers()

        def log_message(self, format: str, *args: object) -> None:  # noqa: A002 - BaseHTTPRequestHandler signature.
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), WebhookHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    settings = get_settings()
    table_path = settings.curated_storage_path + "/metric_alert_webhook_orders"
    write_deltalake(
        table_path,
        pa.table({"status": ["completed", "completed"], "revenue": [150.0, 75.0]}),
        mode="overwrite",
    )

    try:
        with TestClient(app) as client:
            db = SessionLocal()
            try:
                table = DeltaTable(
                    name="metric_alert_webhook_orders",
                    schema_name="analytics",
                    storage_path=table_path,
                    mode="overwrite",
                    schema_json=[
                        {"name": "status", "type": "string"},
                        {"name": "revenue", "type": "double"},
                    ],
                    row_count=2,
                )
                db.add(table)
                db.flush()
                dataset = SemanticDataset(
                    name="metric_alert_webhook_orders_dataset",
                    source_type="delta_table",
                    source_ref=table.name,
                    schema_json=table.schema_json,
                    metrics_json=[{"name": "revenue_sum", "expression": 'SUM("revenue")'}],
                    dimensions_json=[{"name": "status"}],
                )
                db.add(dataset)
                db.flush()
                metric = SemanticMetric(
                    name="metric_alert_webhook_revenue",
                    label="Webhook Revenue",
                    dataset_id=dataset.id,
                    expression='SUM("revenue")',
                    filter_sql="status = 'completed'",
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
            headers = {"Authorization": f"Bearer {login.json()['token']}"}
            webhook_url = f"http://127.0.0.1:{server.server_port}/alerts"

            created = client.post(
                "/api/bi/alerts",
                headers=headers,
                json={
                    "name": "webhook_revenue_alert",
                    "metric_id": metric_id,
                    "comparison": "gt",
                    "threshold_value": 200,
                    "severity": "critical",
                    "enabled": True,
                    "notification_channel": "webhook",
                    "destination": webhook_url,
                },
            )
            assert created.status_code == 200

            evaluated = client.post(f"/api/bi/alerts/{created.json()['id']}/evaluate", headers=headers)
            assert evaluated.status_code == 200
            event = evaluated.json()["event"]
            assert event["triggered"] is True
            assert event["delivery_status"] == "delivered"
            assert event["delivery_channel"] == "webhook"
            assert event["delivery_response_code"] == 202
            assert received_payloads[0]["type"] == "datawizz.metric_alert.triggered"
            assert received_payloads[0]["alert"]["name"] == "webhook_revenue_alert"
            assert received_payloads[0]["metric"]["label"] == "Webhook Revenue"

            delivery_test = client.post(
                "/api/bi/alerts/test-delivery",
                headers=headers,
                json={"notification_channel": "webhook", "destination": webhook_url},
            )
            assert delivery_test.status_code == 200
            assert delivery_test.json()["delivery_status"] == "delivered"
            assert delivery_test.json()["delivery_response_code"] == 202
            assert received_payloads[-1]["type"] == "datawizz.metric_alert.delivery_test"
    finally:
        server.shutdown()
        server.server_close()


def test_webhook_delivery_test_reports_connection_refused_cleanly() -> None:
    with TestClient(app) as client:
        login = client.post(
            "/api/system/login",
            json={"email": "admin@datawizz.local", "password": "datawizz123"},
        )
        headers = {"Authorization": f"Bearer {login.json()['token']}"}
        result = client.post(
            "/api/bi/alerts/test-delivery",
            headers=headers,
            json={"notification_channel": "webhook", "destination": "http://127.0.0.1:9/datawizz-alerts"},
        )
        assert result.status_code == 200
        payload = result.json()
        assert payload["delivery_status"] == "failed"
        assert "Connection refused" in payload["delivery_error"]
        assert "switch delivery back to Local event log" in payload["delivery_error"]
