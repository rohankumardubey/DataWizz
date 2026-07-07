"""add metric alert delivery tracking

Revision ID: 20260708_0005
Revises: 20260705_0004
Create Date: 2026-07-08 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260708_0005"
down_revision = "20260705_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("metric_alert_events", sa.Column("delivery_status", sa.String(length=32), nullable=False, server_default="not_attempted"))
    op.add_column("metric_alert_events", sa.Column("delivery_channel", sa.String(length=64), nullable=True))
    op.add_column("metric_alert_events", sa.Column("delivery_attempted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("metric_alert_events", sa.Column("delivery_response_code", sa.Integer(), nullable=True))
    op.add_column("metric_alert_events", sa.Column("delivery_error", sa.Text(), nullable=True))
    op.create_index("ix_metric_alert_events_delivery_status", "metric_alert_events", ["delivery_status"])


def downgrade() -> None:
    op.drop_index("ix_metric_alert_events_delivery_status", table_name="metric_alert_events")
    op.drop_column("metric_alert_events", "delivery_error")
    op.drop_column("metric_alert_events", "delivery_response_code")
    op.drop_column("metric_alert_events", "delivery_attempted_at")
    op.drop_column("metric_alert_events", "delivery_channel")
    op.drop_column("metric_alert_events", "delivery_status")
