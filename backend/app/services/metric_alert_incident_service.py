from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.bi import MetricAlert, MetricAlertEvent, MetricAlertIncident, MetricAlertIncidentNote, SemanticMetric


ACTIVE_INCIDENT_STATUSES = ("open", "acknowledged")


class MetricAlertIncidentService:
    def record_trigger(self, db: Session, alert: MetricAlert, event: MetricAlertEvent) -> MetricAlertIncident:
        incident = (
            db.query(MetricAlertIncident)
            .filter(MetricAlertIncident.alert_id == alert.id)
            .filter(MetricAlertIncident.status.in_(ACTIVE_INCIDENT_STATUSES))
            .order_by(MetricAlertIncident.opened_at.desc())
            .first()
        )
        if incident is None:
            try:
                with db.begin_nested():
                    incident = MetricAlertIncident(
                        alert_id=alert.id,
                        opened_by_event_id=event.id,
                        latest_event_id=event.id,
                        title=f"{alert.name} incident",
                        status="open",
                        severity=alert.severity,
                        assignee_email=alert.owner_email,
                        trigger_count=1,
                        latest_observed_value=event.observed_value,
                        latest_message=event.message,
                        opened_at=event.evaluated_at,
                        last_triggered_at=event.evaluated_at,
                    )
                    db.add(incident)
                    db.flush()
            except IntegrityError:
                incident = (
                    db.query(MetricAlertIncident)
                    .filter(MetricAlertIncident.alert_id == alert.id)
                    .filter(MetricAlertIncident.status.in_(ACTIVE_INCIDENT_STATUSES))
                    .order_by(MetricAlertIncident.opened_at.desc())
                    .first()
                )
                if incident is None:
                    raise
                self._apply_repeat_trigger(incident, alert, event)
        else:
            self._apply_repeat_trigger(incident, alert, event)
        db.flush()
        return incident

    def list_incidents(
        self,
        db: Session,
        *,
        alert_id: str | None = None,
        status: str | None = None,
        severity: str | None = None,
        assignee_email: str | None = None,
        limit: int = 100,
    ) -> list[dict]:
        query = db.query(MetricAlertIncident)
        if alert_id:
            query = query.filter(MetricAlertIncident.alert_id == alert_id)
        if status == "active":
            query = query.filter(MetricAlertIncident.status.in_(ACTIVE_INCIDENT_STATUSES))
        elif status:
            query = query.filter(MetricAlertIncident.status == status)
        if severity:
            query = query.filter(MetricAlertIncident.severity == severity)
        if assignee_email:
            query = query.filter(func.lower(MetricAlertIncident.assignee_email) == assignee_email.strip().lower())
        incidents = query.order_by(MetricAlertIncident.last_triggered_at.desc()).limit(max(1, min(limit, 200))).all()
        if not incidents:
            return []

        alerts = db.query(MetricAlert).filter(MetricAlert.id.in_({incident.alert_id for incident in incidents})).all()
        alert_by_id = {alert.id: alert for alert in alerts}
        metric_ids = {alert.metric_id for alert in alerts}
        metrics = db.query(SemanticMetric).filter(SemanticMetric.id.in_(metric_ids)).all() if metric_ids else []
        metric_by_id = {metric.id: metric for metric in metrics}
        notes = (
            db.query(MetricAlertIncidentNote)
            .filter(MetricAlertIncidentNote.incident_id.in_({incident.id for incident in incidents}))
            .order_by(MetricAlertIncidentNote.created_at.asc())
            .all()
        )
        notes_by_incident: dict[str, list[MetricAlertIncidentNote]] = {}
        for note in notes:
            notes_by_incident.setdefault(note.incident_id, []).append(note)

        return [
            self._serialize_incident(
                incident,
                alert=alert_by_id.get(incident.alert_id),
                metric_by_id=metric_by_id,
                notes=notes_by_incident.get(incident.id, []),
            )
            for incident in incidents
        ]

    def get_incident(self, db: Session, incident_id: str) -> MetricAlertIncident | None:
        return db.query(MetricAlertIncident).filter(MetricAlertIncident.id == incident_id).one_or_none()

    def serialize_incident(self, db: Session, incident: MetricAlertIncident) -> dict:
        alert = db.query(MetricAlert).filter(MetricAlert.id == incident.alert_id).one_or_none()
        notes = (
            db.query(MetricAlertIncidentNote)
            .filter(MetricAlertIncidentNote.incident_id == incident.id)
            .order_by(MetricAlertIncidentNote.created_at.asc())
            .all()
        )
        metric_by_id: dict[str, SemanticMetric] = {}
        if alert:
            metric = db.query(SemanticMetric).filter(SemanticMetric.id == alert.metric_id).one_or_none()
            if metric:
                metric_by_id[metric.id] = metric
        return self._serialize_incident(incident, alert=alert, metric_by_id=metric_by_id, notes=notes)

    def _serialize_incident(
        self,
        incident: MetricAlertIncident,
        *,
        alert: MetricAlert | None,
        metric_by_id: dict[str, SemanticMetric],
        notes: list[MetricAlertIncidentNote],
    ) -> dict:
        metric = metric_by_id.get(alert.metric_id) if alert else None
        return {
            "id": incident.id,
            "created_at": incident.created_at,
            "updated_at": incident.updated_at,
            "alert_id": incident.alert_id,
            "alert_name": alert.name if alert else None,
            "metric_label": metric.label if metric else None,
            "alert_last_status": alert.last_status if alert else None,
            "opened_by_event_id": incident.opened_by_event_id,
            "latest_event_id": incident.latest_event_id,
            "title": incident.title,
            "status": incident.status,
            "severity": incident.severity,
            "assignee_email": incident.assignee_email,
            "trigger_count": incident.trigger_count,
            "latest_observed_value": incident.latest_observed_value,
            "latest_message": incident.latest_message,
            "opened_at": incident.opened_at,
            "last_triggered_at": incident.last_triggered_at,
            "acknowledged_at": incident.acknowledged_at,
            "acknowledged_by_email": incident.acknowledged_by_email,
            "resolved_at": incident.resolved_at,
            "resolved_by_email": incident.resolved_by_email,
            "resolution_note": incident.resolution_note,
            "notes": [self.serialize_note(note) for note in notes],
        }

    def acknowledge(
        self,
        db: Session,
        incident: MetricAlertIncident,
        *,
        actor_email: str,
        assignee_email: str | None = None,
    ) -> None:
        if incident.status == "resolved":
            raise ValueError("Resolved incidents must be reopened before they can be acknowledged")
        incident.status = "acknowledged"
        incident.acknowledged_at = datetime.now(timezone.utc)
        incident.acknowledged_by_email = actor_email
        incident.assignee_email = self._clean_email(assignee_email) or incident.assignee_email or actor_email

    def assign(self, incident: MetricAlertIncident, assignee_email: str | None) -> None:
        if incident.status == "resolved":
            raise ValueError("Resolved incidents must be reopened before assignment can change")
        incident.assignee_email = self._clean_email(assignee_email)

    def resolve(self, incident: MetricAlertIncident, *, actor_email: str, resolution_note: str) -> None:
        if incident.status == "resolved":
            raise ValueError("Incident is already resolved")
        note = resolution_note.strip()
        if not note:
            raise ValueError("A resolution note is required")
        incident.status = "resolved"
        incident.resolved_at = datetime.now(timezone.utc)
        incident.resolved_by_email = actor_email
        incident.resolution_note = note

    def reopen(self, db: Session, incident: MetricAlertIncident) -> None:
        if incident.status != "resolved":
            raise ValueError("Only resolved incidents can be reopened")
        active_incident = (
            db.query(MetricAlertIncident)
            .filter(MetricAlertIncident.alert_id == incident.alert_id)
            .filter(MetricAlertIncident.id != incident.id)
            .filter(MetricAlertIncident.status.in_(ACTIVE_INCIDENT_STATUSES))
            .one_or_none()
        )
        if active_incident is not None:
            raise ValueError("This alert already has an active incident")
        incident.status = "open"
        incident.acknowledged_at = None
        incident.acknowledged_by_email = None
        incident.resolved_at = None
        incident.resolved_by_email = None
        incident.resolution_note = None

    def add_note(self, db: Session, incident: MetricAlertIncident, *, author_email: str, body: str) -> MetricAlertIncidentNote:
        cleaned_body = body.strip()
        if not cleaned_body:
            raise ValueError("Incident note cannot be empty")
        note = MetricAlertIncidentNote(incident_id=incident.id, author_email=author_email, body=cleaned_body)
        db.add(note)
        db.flush()
        return note

    @staticmethod
    def serialize_note(note: MetricAlertIncidentNote) -> dict:
        return {
            "id": note.id,
            "incident_id": note.incident_id,
            "author_email": note.author_email,
            "body": note.body,
            "created_at": note.created_at,
            "updated_at": note.updated_at,
        }

    @staticmethod
    def _clean_email(value: str | None) -> str | None:
        cleaned = str(value or "").strip().lower()
        return cleaned or None

    def _apply_repeat_trigger(self, incident: MetricAlertIncident, alert: MetricAlert, event: MetricAlertEvent) -> None:
        incident.latest_event_id = event.id
        incident.last_triggered_at = event.evaluated_at
        incident.trigger_count += 1
        incident.latest_observed_value = event.observed_value
        incident.latest_message = event.message
        incident.severity = self._highest_severity(incident.severity, alert.severity)

    @staticmethod
    def _highest_severity(current: str, incoming: str) -> str:
        rank = {"info": 0, "warning": 1, "critical": 2}
        return incoming if rank.get(incoming, 0) > rank.get(current, 0) else current


metric_alert_incident_service = MetricAlertIncidentService()
