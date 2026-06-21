from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import TimestampedModel


class DeltaTableRead(TimestampedModel):
    name: str
    schema_name: str
    storage_path: str
    description: str | None = None
    schema_definition: list[dict] | None = Field(default=None, alias="schema_json", serialization_alias="schema_json")
    mode: str
    source_query: str | None = None
    row_count: int | None = None
    last_refreshed_at: datetime | None = None
    owner: str | None = None
    tags: list[str] | None = None
    freshness_status: str | None = None
    lineage_hint: str | None = None
    governance_score: int | None = None
    governance_grade: str | None = None
    governance_status: str | None = None
    governance_summary: str | None = None
    governance_strengths: list[str] | None = None
    governance_gaps: list[str] | None = None
    governance_breakdown: list[dict] | None = None
    contract_mode: str | None = None
    contract_version: int | None = None
    contract_schema_json: list[dict] | None = None
    contract_required_columns: list[str] | None = None
    contract_allow_additive_columns: bool | None = None
    contract_allow_column_removal: bool | None = None
    contract_allow_type_changes: bool | None = None
    contract_last_check_status: str | None = None
    contract_last_check_summary: str | None = None
    contract_last_check_issues: list[str] | None = None
    contract_last_check_at: datetime | None = None
    quality_suite_name: str | None = None
    quality_expectations: list[dict] | None = None
    quality_last_run_status: str | None = None
    quality_last_run_summary: str | None = None
    quality_last_run_at: datetime | None = None
    quality_last_run_results: list[dict] | None = None
    quality_schedule_cron: str | None = None
    quality_schedule_enabled: bool | None = None
    quality_schedule_updated_at: datetime | None = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class DeltaTableListResponse(BaseModel):
    items: list[DeltaTableRead]


class DeltaTablePreviewResponse(BaseModel):
    table: DeltaTableRead
    columns: list[str]
    rows: list[dict]


class DeltaTableMetadataUpdateRequest(BaseModel):
    owner: str | None = None
    tags: list[str] | None = None
    lineage_hint: str | None = None


class DeltaTableContractUpdateRequest(BaseModel):
    contract_mode: str = Field(default="warn", pattern="^(off|warn|strict)$")
    contract_required_columns: list[str] | None = None
    contract_allow_additive_columns: bool = True
    contract_allow_column_removal: bool = False
    contract_allow_type_changes: bool = False
    adopt_current_schema: bool = False


class QualityExpectation(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    expectation_type: str = Field(pattern="^(row_count_between|not_null|unique|accepted_values)$")
    enabled: bool = True
    severity: str = Field(default="error", pattern="^(warning|error)$")
    column: str | None = None
    min_value: int | None = Field(default=None, ge=0)
    max_value: int | None = Field(default=None, ge=0)
    accepted_values: list[str] | None = None

    @model_validator(mode="after")
    def validate_configuration(self) -> "QualityExpectation":
        if self.expectation_type != "row_count_between" and not (self.column or "").strip():
            raise ValueError("A column is required for column expectations")
        if self.expectation_type == "row_count_between" and self.min_value is None and self.max_value is None:
            raise ValueError("Row-count expectations require a minimum or maximum")
        if self.expectation_type == "accepted_values" and not self.accepted_values:
            raise ValueError("Accepted-value expectations require at least one value")
        if self.min_value is not None and self.max_value is not None and self.min_value > self.max_value:
            raise ValueError("Minimum value cannot be greater than maximum value")
        return self


class QualitySuiteUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    expectations: list[QualityExpectation] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_expectation_ids(self) -> "QualitySuiteUpdateRequest":
        expectation_ids = [expectation.id for expectation in self.expectations]
        if len(expectation_ids) != len(set(expectation_ids)):
            raise ValueError("Expectation IDs must be unique within a suite")
        return self


class QualityRunResponse(BaseModel):
    id: str
    table_id: str
    pipeline_run_id: str | None = None
    node_id: str | None = None
    suite_name: str
    trigger_type: str
    status: str
    success: bool
    row_count: int
    expectation_count: int
    passed_count: int
    failed_count: int
    summary: str
    results_json: list[dict]
    started_at: datetime
    finished_at: datetime
    duration_ms: int

    model_config = {"from_attributes": True}


class QualityRunListResponse(BaseModel):
    items: list[QualityRunResponse]


class QualityScheduleUpdateRequest(BaseModel):
    cron: str | None = None
    enabled: bool = False


class QualitySchedulerSweepResponse(BaseModel):
    checked: int
    triggered: list[dict] = Field(default_factory=list)
    invalid_schedules: list[dict] = Field(default_factory=list)
    next_due: list[dict] = Field(default_factory=list)


class QualitySchedulerStatusResponse(BaseModel):
    enabled: bool
    running: bool
    timezone: str
    poll_interval_seconds: int
    last_tick_at: str | None = None
    last_error: str | None = None
    managed_table_count: int
    last_summary: QualitySchedulerSweepResponse
