import json

from app.services.openlineage_service import OpenLineageService


def test_openlineage_events_are_standard_and_queryable(tmp_path) -> None:
    service = OpenLineageService()
    service.events_path = tmp_path / "events.jsonl"
    service.settings.openlineage_enabled = True
    service.settings.openlineage_transport_url = None

    envelope = service.emit(
        event_type="COMPLETE",
        job_name="pipeline.orders",
        run_id="run-123",
        inputs=[service.dataset(namespace="file://localhost", name="/tmp/orders.csv")],
        outputs=[service.dataset(namespace="datawizz://delta/analytics", name="orders")],
        run_facets={"datawizz": {"status": "success"}},
    )

    assert envelope is not None
    event = envelope["event"]
    assert event["eventType"] == "COMPLETE"
    assert event["schemaURL"].endswith("OpenLineage.json")
    assert event["run"]["runId"] == "run-123"
    assert event["run"]["facets"]["datawizz"]["status"] == "success"
    assert event["outputs"][0]["name"] == "orders"
    assert envelope["delivery"]["status"] == "local_only"

    stored = json.loads(service.events_path.read_text(encoding="utf-8").strip())
    assert stored["event"]["job"]["name"] == "pipeline.orders"
    assert service.list_events(run_id="run-123")[0]["event"]["eventType"] == "COMPLETE"
    assert service.list_events(event_type="FAIL") == []


def test_openlineage_storage_failure_never_breaks_execution(tmp_path) -> None:
    service = OpenLineageService()
    service.events_path = tmp_path
    service.settings.openlineage_enabled = True
    service.settings.openlineage_transport_url = None

    envelope = service.emit(event_type="START", job_name="notebook.demo", run_id="run-456")

    assert envelope is not None
    assert envelope["storage"]["status"] == "failed"
