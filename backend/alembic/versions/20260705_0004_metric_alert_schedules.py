"""add metric alert schedules

Revision ID: 20260705_0004
Revises: 20260704_0003
Create Date: 2026-07-05 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260705_0004"
down_revision = "20260704_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("metric_alerts", sa.Column("schedule_cron", sa.String(length=128), nullable=True))
    op.add_column("metric_alerts", sa.Column("schedule_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("metric_alerts", sa.Column("schedule_updated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("metric_alert_events", sa.Column("trigger_type", sa.String(length=32), nullable=False, server_default="manual"))
    op.create_index("ix_metric_alert_events_trigger_type_evaluated_at", "metric_alert_events", ["trigger_type", "evaluated_at"])


def downgrade() -> None:
    op.drop_index("ix_metric_alert_events_trigger_type_evaluated_at", table_name="metric_alert_events")
    op.drop_column("metric_alert_events", "trigger_type")
    op.drop_column("metric_alerts", "schedule_updated_at")
    op.drop_column("metric_alerts", "schedule_enabled")
    op.drop_column("metric_alerts", "schedule_cron")
