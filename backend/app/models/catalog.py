from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.common import TimestampMixin, UUIDPrimaryKeyMixin


class UploadedFile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "uploaded_files"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    file_type: Mapped[str] = mapped_column(String(32), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    schema_json: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    row_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    source: Mapped[str] = mapped_column(String(32), default="local", nullable=False)


class DeltaTable(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "delta_tables"

    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    schema_name: Mapped[str] = mapped_column(String(128), default="analytics", nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    schema_json: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    mode: Mapped[str] = mapped_column(String(32), default="overwrite", nullable=False)
    source_query: Mapped[str | None] = mapped_column(Text, nullable=True)
    row_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    last_refreshed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class QueryHistory(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "queries"

    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sql_text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="success", nullable=False)
    execution_ms: Mapped[int | None] = mapped_column(nullable=True)
    row_count: Mapped[int | None] = mapped_column(nullable=True)
    result_preview: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


class QualityRun(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "quality_runs"

    table_id: Mapped[str] = mapped_column(ForeignKey("delta_tables.id", ondelete="CASCADE"), nullable=False)
    pipeline_run_id: Mapped[str | None] = mapped_column(ForeignKey("pipeline_runs.id", ondelete="SET NULL"), nullable=True)
    node_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    suite_name: Mapped[str] = mapped_column(String(255), nullable=False)
    trigger_type: Mapped[str] = mapped_column(String(32), default="manual", nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    success: Mapped[bool] = mapped_column(nullable=False)
    row_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    expectation_count: Mapped[int] = mapped_column(Integer, nullable=False)
    passed_count: Mapped[int] = mapped_column(Integer, nullable=False)
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    results_json: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
