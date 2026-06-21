from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.core.config import get_settings


class OpenLineageService:
    producer = "https://github.com/rohankumardubey/DataWizz"
    schema_url = "https://openlineage.io/spec/2-0-2/OpenLineage.json"
    custom_facet_schema = "https://raw.githubusercontent.com/rohankumardubey/DataWizz/main/docs/openlineage-facet.json"

    def __init__(self) -> None:
        self.settings = get_settings()
        self.events_path = Path(self.settings.temp_storage_path) / "openlineage" / "events.jsonl"
        self._lock = threading.Lock()

    def emit(
        self,
        *,
        event_type: str,
        job_name: str,
        run_id: str,
        inputs: list[dict[str, Any]] | None = None,
        outputs: list[dict[str, Any]] | None = None,
        run_facets: dict[str, Any] | None = None,
        job_facets: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        if not self.settings.openlineage_enabled:
            return None

        event = {
            "eventType": event_type,
            "eventTime": datetime.now(timezone.utc).isoformat(),
            "run": {
                "runId": run_id,
                "facets": self._with_datawizz_facet(run_facets or {}),
            },
            "job": {
                "namespace": self.settings.openlineage_namespace,
                "name": job_name,
                "facets": self._with_datawizz_facet(job_facets or {}),
            },
            "inputs": inputs or [],
            "outputs": outputs or [],
            "producer": self.producer,
            "schemaURL": self.schema_url,
        }
        try:
            delivery = self._deliver(event)
        except Exception as exc:  # noqa: BLE001
            delivery = {"status": "failed", "http_status": None, "detail": str(exc)}
        envelope = {"event": event, "delivery": delivery}
        try:
            self._append(envelope)
        except Exception as exc:  # noqa: BLE001
            envelope["storage"] = {"status": "failed", "detail": str(exc)}
        return envelope

    def list_events(
        self,
        *,
        limit: int = 100,
        event_type: str | None = None,
        job_name: str | None = None,
        run_id: str | None = None,
    ) -> list[dict[str, Any]]:
        if not self.events_path.exists():
            return []
        events: list[dict[str, Any]] = []
        with self._lock:
            lines = self.events_path.read_text(encoding="utf-8").splitlines()
        for line in reversed(lines):
            try:
                envelope = json.loads(line)
            except json.JSONDecodeError:
                continue
            event = envelope.get("event") or {}
            if event_type and event.get("eventType") != event_type:
                continue
            if job_name and event.get("job", {}).get("name") != job_name:
                continue
            if run_id and event.get("run", {}).get("runId") != run_id:
                continue
            events.append(envelope)
            if len(events) >= limit:
                break
        return events

    def get_status(self) -> dict[str, Any]:
        recent = self.list_events(limit=500)
        delivery_failures = sum(1 for item in recent if item.get("delivery", {}).get("status") == "failed")
        return {
            "enabled": self.settings.openlineage_enabled,
            "namespace": self.settings.openlineage_namespace,
            "transport_mode": "http" if self.settings.openlineage_transport_url else "local",
            "transport_url": self.settings.openlineage_transport_url,
            "events_path": str(self.events_path),
            "event_count": len(recent),
            "delivery_failures": delivery_failures,
            "latest_event_at": recent[0].get("event", {}).get("eventTime") if recent else None,
        }

    def dataset(
        self,
        *,
        namespace: str,
        name: str,
        fields: list[dict[str, Any]] | None = None,
        facets: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        dataset_facets = self._with_datawizz_facet(facets or {})
        if fields:
            dataset_facets["schema"] = {
                "_producer": self.producer,
                "_schemaURL": "https://openlineage.io/spec/facets/1-1-1/SchemaDatasetFacet.json",
                "fields": [
                    {"name": str(field.get("name")), "type": str(field.get("type") or "unknown")}
                    for field in fields
                    if field.get("name")
                ],
            }
        return {"namespace": namespace, "name": name, "facets": dataset_facets}

    def _with_datawizz_facet(self, facets: dict[str, Any]) -> dict[str, Any]:
        payload = dict(facets)
        datawizz_payload = dict(payload.get("datawizz") or {})
        payload["datawizz"] = {
            "_producer": self.producer,
            "_schemaURL": self.custom_facet_schema,
            "platform": "DataWizz",
            "localFirst": True,
            **datawizz_payload,
        }
        return payload

    def _deliver(self, event: dict[str, Any]) -> dict[str, Any]:
        transport_url = self.settings.openlineage_transport_url
        if not transport_url:
            return {"status": "local_only", "http_status": None, "detail": "No external transport configured."}

        headers = {"Content-Type": "application/json"}
        if self.settings.openlineage_api_key:
            headers["Authorization"] = f"Bearer {self.settings.openlineage_api_key}"
        request = Request(
            transport_url,
            data=json.dumps(event).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.settings.openlineage_timeout_seconds) as response:
                return {
                    "status": "delivered" if 200 <= response.status < 300 else "failed",
                    "http_status": response.status,
                    "detail": "Event delivered to the configured OpenLineage transport.",
                }
        except HTTPError as exc:
            return {"status": "failed", "http_status": exc.code, "detail": f"HTTP {exc.code}: {exc.reason}"}
        except (URLError, TimeoutError, OSError) as exc:
            return {"status": "failed", "http_status": None, "detail": str(exc)}

    def _append(self, envelope: dict[str, Any]) -> None:
        self.events_path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(envelope, separators=(",", ":"), default=str)
        with self._lock:
            with self.events_path.open("a", encoding="utf-8") as stream:
                stream.write(line + "\n")


openlineage_service = OpenLineageService()
