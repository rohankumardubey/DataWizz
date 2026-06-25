"""add semantic metrics

Revision ID: 20260625_0002
Revises: 20260526_0001
Create Date: 2026-06-25 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260625_0002"
down_revision = "20260526_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "semantic_metrics",
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("dataset_id", sa.String(), nullable=False),
        sa.Column("expression", sa.Text(), nullable=False),
        sa.Column("filter_sql", sa.Text(), nullable=True),
        sa.Column("dimensions_json", sa.JSON(), nullable=True),
        sa.Column("format", sa.String(length=64), nullable=False, server_default="number"),
        sa.Column("owner_email", sa.String(length=255), nullable=True),
        sa.Column("is_certified", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["dataset_id"], ["semantic_datasets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )


def downgrade() -> None:
    op.drop_table("semantic_metrics")
