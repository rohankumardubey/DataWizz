from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.common import TimestampMixin, UUIDPrimaryKeyMixin


class SemanticDataset(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "semantic_datasets"

    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_ref: Mapped[str] = mapped_column(String(255), nullable=False)
    source_config_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    schema_json: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    metrics_json: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    dimensions_json: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)


class SemanticMetric(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "semantic_metrics"

    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("semantic_datasets.id", ondelete="CASCADE"), nullable=False)
    expression: Mapped[str] = mapped_column(Text, nullable=False)
    filter_sql: Mapped[str | None] = mapped_column(Text, nullable=True)
    dimensions_json: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    format: Mapped[str] = mapped_column(String(64), nullable=False, default="number")
    owner_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_certified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class MetricAlert(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "metric_alerts"

    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    metric_id: Mapped[str] = mapped_column(ForeignKey("semantic_metrics.id", ondelete="CASCADE"), nullable=False)
    comparison: Mapped[str] = mapped_column(String(16), nullable=False)
    threshold_value: Mapped[float] = mapped_column(Float, nullable=False)
    severity: Mapped[str] = mapped_column(String(32), nullable=False, default="warning")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    owner_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notification_channel: Mapped[str] = mapped_column(String(64), nullable=False, default="local")
    destination: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_status: Mapped[str] = mapped_column(String(32), nullable=False, default="not_evaluated")
    last_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_evaluated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MetricAlertEvent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "metric_alert_events"

    alert_id: Mapped[str] = mapped_column(ForeignKey("metric_alerts.id", ondelete="CASCADE"), nullable=False)
    metric_id: Mapped[str | None] = mapped_column(ForeignKey("semantic_metrics.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    triggered: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    observed_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    threshold_value: Mapped[float] = mapped_column(Float, nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    evaluated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    details_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class Chart(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "charts"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    chart_type: Mapped[str] = mapped_column(String(64), nullable=False)
    dataset_id: Mapped[str | None] = mapped_column(ForeignKey("semantic_datasets.id", ondelete="SET NULL"), nullable=True)
    query_sql: Mapped[str] = mapped_column(Text, nullable=False)
    config_json: Mapped[dict] = mapped_column(JSON, nullable=False)


class Dashboard(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "dashboards"

    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    layout_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    filters_json: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    owner_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    visibility: Mapped[str] = mapped_column(String(32), nullable=False, default="workspace")
    shared_roles_json: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)


class DashboardWidget(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "dashboard_widgets"

    dashboard_id: Mapped[str] = mapped_column(ForeignKey("dashboards.id", ondelete="CASCADE"), nullable=False)
    chart_id: Mapped[str | None] = mapped_column(ForeignKey("charts.id", ondelete="SET NULL"), nullable=True)
    widget_type: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    layout_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    config_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class ReportSchedule(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "report_schedules"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    dashboard_id: Mapped[str | None] = mapped_column(ForeignKey("dashboards.id", ondelete="SET NULL"), nullable=True)
    frequency: Mapped[str] = mapped_column(String(32), nullable=False)
    destination: Mapped[str] = mapped_column(String(64), default="local_export", nullable=False)
    config_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class ReportSnapshot(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "report_snapshots"

    schedule_id: Mapped[str | None] = mapped_column(ForeignKey("report_schedules.id", ondelete="SET NULL"), nullable=True)
    dashboard_id: Mapped[str | None] = mapped_column(ForeignKey("dashboards.id", ondelete="SET NULL"), nullable=True)
    schedule_name: Mapped[str] = mapped_column(String(255), nullable=False)
    dashboard_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    requested_format: Mapped[str] = mapped_column(String(32), nullable=False)
    destination: Mapped[str] = mapped_column(String(64), nullable=False, default="local_export")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    artifact_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    artifact_file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    artifact_kind: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
