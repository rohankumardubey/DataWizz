"""add metric alerts

Revision ID: 20260704_0003
Revises: 20260625_0002
Create Date: 2026-07-04 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260704_0003"
down_revision = "20260625_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "metric_alerts",
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("metric_id", sa.String(), nullable=False),
        sa.Column("comparison", sa.String(length=16), nullable=False),
        sa.Column("threshold_value", sa.Float(), nullable=False),
        sa.Column("severity", sa.String(length=32), nullable=False, server_default="warning"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("owner_email", sa.String(length=255), nullable=True),
        sa.Column("notification_channel", sa.String(length=64), nullable=False, server_default="local"),
        sa.Column("destination", sa.String(length=255), nullable=True),
        sa.Column("last_status", sa.String(length=32), nullable=False, server_default="not_evaluated"),
        sa.Column("last_value", sa.Float(), nullable=True),
        sa.Column("last_message", sa.Text(), nullable=True),
        sa.Column("last_evaluated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["metric_id"], ["semantic_metrics.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "metric_alert_events",
        sa.Column("alert_id", sa.String(), nullable=False),
        sa.Column("metric_id", sa.String(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("triggered", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("observed_value", sa.Float(), nullable=True),
        sa.Column("threshold_value", sa.Float(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("details_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["alert_id"], ["metric_alerts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["metric_id"], ["semantic_metrics.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_metric_alert_events_alert_id_created_at", "metric_alert_events", ["alert_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_metric_alert_events_alert_id_created_at", table_name="metric_alert_events")
    op.drop_table("metric_alert_events")
    op.drop_table("metric_alerts")
