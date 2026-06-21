import asyncio
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from croniter import croniter
from sqlalchemy import desc

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.catalog import DeltaTable, QualityRun
from app.services.catalog_metadata_service import CatalogMetadataService
from app.services.data_quality_service import DataQualityService


class QualitySchedulerService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.catalog_metadata_service = CatalogMetadataService()
        self.data_quality_service = DataQualityService()
        self.timezone = ZoneInfo(self.settings.scheduler_timezone)
        self._task: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None
        self._running = False
        self._last_tick_at: datetime | None = None
        self._last_error: str | None = None
        self._last_summary: dict[str, Any] = {
            "checked": 0,
            "triggered": [],
            "invalid_schedules": [],
            "next_due": [],
        }

    @property
    def enabled(self) -> bool:
        return bool(self.settings.scheduler_enabled)

    @property
    def poll_interval_seconds(self) -> int:
        return max(int(self.settings.scheduler_poll_interval_seconds), 5)

    async def start(self) -> None:
        if not self.enabled or self._task is not None:
            return
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self._run_loop(), name="quality-scheduler")
        self._running = True

    async def stop(self) -> None:
        if self._task is None:
            return
        if self._stop_event is not None:
            self._stop_event.set()
        await self._task
        self._task = None
        self._stop_event = None
        self._running = False

    async def _run_loop(self) -> None:
        while self._stop_event is not None and not self._stop_event.is_set():
            try:
                self.run_due_once()
            except Exception as exc:  # noqa: BLE001
                self._last_error = str(exc)
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.poll_interval_seconds)
            except TimeoutError:
                continue
        self._running = False

    def compute_next_run_at(self, table: DeltaTable, last_run: QualityRun | None) -> datetime | None:
        settings = self.catalog_metadata_service.get_quality_suite(table)
        cron = (settings.get("quality_schedule_cron") or "").strip()
        if not settings.get("quality_schedule_enabled") or not cron or not croniter.is_valid(cron):
            return None
        reference = (
            last_run.started_at
            if last_run is not None
            else self._parse_timestamp(settings.get("quality_schedule_updated_at"))
            or table.updated_at
            or table.created_at
            or datetime.now(timezone.utc)
        )
        if reference.tzinfo is None:
            reference = reference.replace(tzinfo=timezone.utc)
        return croniter(cron, reference.astimezone(self.timezone)).get_next(datetime).astimezone(timezone.utc)

    def run_due_once(self) -> dict[str, Any]:
        summary: dict[str, Any] = {
            "checked": 0,
            "triggered": [],
            "invalid_schedules": [],
            "next_due": [],
        }
        now_utc = datetime.now(timezone.utc)
        with SessionLocal() as db:
            tables = db.query(DeltaTable).order_by(DeltaTable.updated_at.desc()).all()
            for table in tables:
                schedule = self.catalog_metadata_service.get_quality_suite(table)
                cron = (schedule.get("quality_schedule_cron") or "").strip()
                if not schedule.get("quality_schedule_enabled"):
                    continue
                summary["checked"] += 1
                if not croniter.is_valid(cron):
                    summary["invalid_schedules"].append(
                        {"table_id": table.id, "table_name": table.name, "cron": cron, "reason": "Invalid cron expression"}
                    )
                    continue
                last_run = (
                    db.query(QualityRun)
                    .filter(QualityRun.table_id == table.id)
                    .filter(QualityRun.trigger_type == "scheduled")
                    .order_by(desc(QualityRun.started_at))
                    .first()
                )
                next_run_at = self.compute_next_run_at(table, last_run)
                if next_run_at is not None:
                    summary["next_due"].append(
                        {
                            "table_id": table.id,
                            "table_name": f"{table.schema_name}.{table.name}",
                            "cron": cron,
                            "next_run_at": next_run_at.isoformat(),
                        }
                    )
                if next_run_at is None or next_run_at > now_utc:
                    continue
                run = self.data_quality_service.execute(db, table, trigger_type="scheduled")
                summary["triggered"].append(
                    {
                        "table_id": table.id,
                        "table_name": f"{table.schema_name}.{table.name}",
                        "quality_run_id": run.id,
                        "status": run.status,
                    }
                )

        summary["next_due"] = sorted(summary["next_due"], key=lambda item: item["next_run_at"])[:20]
        self._last_tick_at = now_utc
        self._last_error = None
        self._last_summary = summary
        return summary

    def get_status(self) -> dict[str, Any]:
        managed_count = 0
        with SessionLocal() as db:
            for table in db.query(DeltaTable).all():
                if self.catalog_metadata_service.get_quality_suite(table).get("quality_schedule_enabled"):
                    managed_count += 1
        return {
            "enabled": self.enabled,
            "running": self._running,
            "timezone": self.settings.scheduler_timezone,
            "poll_interval_seconds": self.poll_interval_seconds,
            "last_tick_at": self._last_tick_at.isoformat() if self._last_tick_at else None,
            "last_error": self._last_error,
            "managed_table_count": managed_count,
            "last_summary": self._last_summary,
        }

    def _parse_timestamp(self, value: str | None) -> datetime | None:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None


quality_scheduler_service = QualitySchedulerService()
