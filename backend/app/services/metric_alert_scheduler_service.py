import asyncio
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from croniter import croniter
from sqlalchemy import desc

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.bi import MetricAlert, MetricAlertEvent
from app.services.bi_service import BiService


class MetricAlertSchedulerService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.bi_service = BiService()
        self.timezone = ZoneInfo(self.settings.scheduler_timezone)
        self._task: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None
        self._running = False
        self._last_tick_at: datetime | None = None
        self._last_error: str | None = None
        self._last_summary: dict[str, Any] = {
            "checked": 0,
            "evaluated": [],
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
        self._task = asyncio.create_task(self._run_loop(), name="metric-alert-scheduler")
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

    def compute_next_run_at(self, alert: MetricAlert, last_scheduled_event: MetricAlertEvent | None) -> datetime | None:
        cron = (alert.schedule_cron or "").strip()
        if not alert.enabled or not alert.schedule_enabled or not cron or not croniter.is_valid(cron):
            return None
        reference = (
            last_scheduled_event.evaluated_at
            if last_scheduled_event is not None
            else alert.schedule_updated_at
            or alert.updated_at
            or alert.created_at
            or datetime.now(timezone.utc)
        )
        if reference.tzinfo is None:
            reference = reference.replace(tzinfo=timezone.utc)
        return croniter(cron, reference.astimezone(self.timezone)).get_next(datetime).astimezone(timezone.utc)

    def run_due_once(self) -> dict[str, Any]:
        summary: dict[str, Any] = {
            "checked": 0,
            "evaluated": [],
            "invalid_schedules": [],
            "next_due": [],
        }
        now_utc = datetime.now(timezone.utc)
        with SessionLocal() as db:
            alerts = (
                db.query(MetricAlert)
                .filter(MetricAlert.schedule_enabled.is_(True))
                .order_by(MetricAlert.updated_at.desc())
                .all()
            )
            summary["checked"] = len(alerts)

            for alert in alerts:
                cron = (alert.schedule_cron or "").strip()
                if not alert.enabled:
                    continue
                if not croniter.is_valid(cron):
                    summary["invalid_schedules"].append(
                        {
                            "alert_id": alert.id,
                            "alert_name": alert.name,
                            "cron": cron,
                            "reason": "Invalid cron expression",
                        }
                    )
                    continue

                last_scheduled_event = (
                    db.query(MetricAlertEvent)
                    .filter(MetricAlertEvent.alert_id == alert.id)
                    .filter(MetricAlertEvent.trigger_type == "scheduled")
                    .order_by(desc(MetricAlertEvent.evaluated_at), desc(MetricAlertEvent.created_at))
                    .first()
                )
                next_run_at = self.compute_next_run_at(alert, last_scheduled_event)
                if next_run_at is not None:
                    summary["next_due"].append(
                        {
                            "alert_id": alert.id,
                            "alert_name": alert.name,
                            "cron": cron,
                            "next_run_at": next_run_at.isoformat(),
                        }
                    )
                if next_run_at is None or next_run_at > now_utc:
                    continue

                event = self.bi_service.evaluate_metric_alert(db, alert, trigger_type="scheduled")
                db.flush()
                summary["evaluated"].append(
                    {
                        "alert_id": alert.id,
                        "alert_name": alert.name,
                        "event_id": event.id,
                        "status": event.status,
                        "triggered": event.triggered,
                    }
                )

            db.commit()

        summary["next_due"] = sorted(summary["next_due"], key=lambda item: item["next_run_at"])[:20]
        self._last_tick_at = now_utc
        self._last_error = None
        self._last_summary = summary
        return summary

    def get_status(self) -> dict[str, Any]:
        managed_count = 0
        with SessionLocal() as db:
            managed_count = db.query(MetricAlert).filter(MetricAlert.schedule_enabled.is_(True)).count()
        return {
            "enabled": self.enabled,
            "running": self._running,
            "timezone": self.settings.scheduler_timezone,
            "poll_interval_seconds": self.poll_interval_seconds,
            "last_tick_at": self._last_tick_at.isoformat() if self._last_tick_at else None,
            "last_error": self._last_error,
            "managed_alert_count": managed_count,
            "last_summary": self._last_summary,
        }


metric_alert_scheduler_service = MetricAlertSchedulerService()
