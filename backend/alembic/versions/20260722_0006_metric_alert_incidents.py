"""add metric alert incident workflow

Revision ID: 20260722_0006
Revises: 20260708_0005
Create Date: 2026-07-22 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260722_0006"
down_revision = "20260708_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "metric_alert_incidents",
        sa.Column("alert_id", sa.String(), nullable=False),
        sa.Column("opened_by_event_id", sa.String(), nullable=True),
        sa.Column("latest_event_id", sa.String(), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="open"),
        sa.Column("severity", sa.String(length=32), nullable=False, server_default="warning"),
        sa.Column("assignee_email", sa.String(length=255), nullable=True),
        sa.Column("trigger_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("latest_observed_value", sa.Float(), nullable=True),
        sa.Column("latest_message", sa.Text(), nullable=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_by_email", sa.String(length=255), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by_email", sa.String(length=255), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["alert_id"], ["metric_alerts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["opened_by_event_id"], ["metric_alert_events.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["latest_event_id"], ["metric_alert_events.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_metric_alert_incidents_status_last_triggered_at",
        "metric_alert_incidents",
        ["status", "last_triggered_at"],
    )
    op.create_index(
        "ix_metric_alert_incidents_alert_id_status",
        "metric_alert_incidents",
        ["alert_id", "status"],
    )
    op.create_index(
        "uq_metric_alert_incidents_active_alert",
        "metric_alert_incidents",
        ["alert_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('open', 'acknowledged')"),
        sqlite_where=sa.text("status IN ('open', 'acknowledged')"),
    )
    op.create_table(
        "metric_alert_incident_notes",
        sa.Column("incident_id", sa.String(), nullable=False),
        sa.Column("author_email", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["incident_id"], ["metric_alert_incidents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_metric_alert_incident_notes_incident_id_created_at",
        "metric_alert_incident_notes",
        ["incident_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_metric_alert_incident_notes_incident_id_created_at", table_name="metric_alert_incident_notes")
    op.drop_table("metric_alert_incident_notes")
    op.drop_index("uq_metric_alert_incidents_active_alert", table_name="metric_alert_incidents")
    op.drop_index("ix_metric_alert_incidents_alert_id_status", table_name="metric_alert_incidents")
    op.drop_index("ix_metric_alert_incidents_status_last_triggered_at", table_name="metric_alert_incidents")
    op.drop_table("metric_alert_incidents")
