from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import TimestampedModel


class CandidateDatasetRead(BaseModel):
    id: str
    name: str
    schema_name: str | None = None
    source_type: str
    source_ref: str
    description: str | None = None
    schema_definition: list[dict] | None = Field(default=None, alias="schema_json", serialization_alias="schema_json")
    row_count: int | None = None
    updated_at: str | None = None

    model_config = {"protected_namespaces": (), "populate_by_name": True}


class SemanticDatasetCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    source_type: str
    source_ref: str
    source_config: dict | None = Field(default=None, alias="source_config_json", serialization_alias="source_config_json")
    description: str | None = None
    schema_definition: list[dict] | None = Field(default=None, alias="schema_json", serialization_alias="schema_json")
    metrics_json: list[dict] | None = None
    dimensions_json: list[dict] | None = None

    model_config = {"protected_namespaces": (), "populate_by_name": True}


class SemanticDatasetUpdateRequest(BaseModel):
    name: str = Field(min_length=1)
    source_type: str
    source_ref: str
    source_config: dict | None = Field(default=None, alias="source_config_json", serialization_alias="source_config_json")
    description: str | None = None
    schema_definition: list[dict] | None = Field(default=None, alias="schema_json", serialization_alias="schema_json")
    metrics_json: list[dict] | None = None
    dimensions_json: list[dict] | None = None

    model_config = {"protected_namespaces": (), "populate_by_name": True}


class SemanticDatasetRead(TimestampedModel):
    name: str
    source_type: str
    source_ref: str
    source_config: dict | None = Field(default=None, alias="source_config_json", serialization_alias="source_config_json")
    description: str | None = None
    schema_definition: list[dict] | None = Field(default=None, alias="schema_json", serialization_alias="schema_json")
    metrics_json: list[dict] | None = None
    dimensions_json: list[dict] | None = None

    model_config = {"protected_namespaces": (), "from_attributes": True, "populate_by_name": True}


class SemanticMetricCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    label: str = Field(min_length=1)
    dataset_id: str
    expression: str = Field(min_length=1)
    description: str | None = None
    filter_sql: str | None = None
    dimensions_json: list[str] = Field(default_factory=list)
    format: str = "number"
    is_certified: bool = False


class SemanticMetricUpdateRequest(BaseModel):
    name: str = Field(min_length=1)
    label: str = Field(min_length=1)
    dataset_id: str
    expression: str = Field(min_length=1)
    description: str | None = None
    filter_sql: str | None = None
    dimensions_json: list[str] = Field(default_factory=list)
    format: str = "number"
    is_certified: bool = False


class SemanticMetricRead(TimestampedModel):
    name: str
    label: str
    description: str | None = None
    dataset_id: str
    dataset_name: str | None = None
    source_ref: str | None = None
    expression: str
    filter_sql: str | None = None
    dimensions_json: list[str] | None = None
    format: str
    owner_email: str | None = None
    is_certified: bool

    model_config = {"from_attributes": True}


class SemanticMetricListResponse(BaseModel):
    items: list[SemanticMetricRead]


class SemanticMetricPreviewRequest(BaseModel):
    dimensions: list[str] = Field(default_factory=list)
    where_sql: str | None = None
    limit: int = Field(default=100, ge=1, le=500)


class SemanticMetricPreviewResponse(BaseModel):
    metric: SemanticMetricRead
    sql: str
    columns: list[str]
    rows: list[dict]
    row_count: int


class MetricAlertCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    metric_id: str
    comparison: str = Field(pattern="^(gt|gte|lt|lte|eq|neq)$")
    threshold_value: float
    severity: str = Field(default="warning", pattern="^(info|warning|critical)$")
    enabled: bool = True
    notification_channel: str = Field(default="local", pattern="^(local|webhook)$")
    destination: str | None = None
    schedule_cron: str | None = None
    schedule_enabled: bool = False


class MetricAlertUpdateRequest(BaseModel):
    name: str = Field(min_length=1)
    metric_id: str
    comparison: str = Field(pattern="^(gt|gte|lt|lte|eq|neq)$")
    threshold_value: float
    severity: str = Field(default="warning", pattern="^(info|warning|critical)$")
    enabled: bool = True
    notification_channel: str = Field(default="local", pattern="^(local|webhook)$")
    destination: str | None = None
    schedule_cron: str | None = None
    schedule_enabled: bool = False


class MetricAlertRead(TimestampedModel):
    name: str
    metric_id: str
    metric_name: str | None = None
    metric_label: str | None = None
    dataset_name: str | None = None
    source_ref: str | None = None
    comparison: str
    threshold_value: float
    severity: str
    enabled: bool
    owner_email: str | None = None
    notification_channel: str
    destination: str | None = None
    last_status: str
    last_value: float | None = None
    last_message: str | None = None
    last_evaluated_at: datetime | None = None
    schedule_cron: str | None = None
    schedule_enabled: bool
    schedule_updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class MetricAlertEventRead(TimestampedModel):
    alert_id: str
    alert_name: str | None = None
    metric_id: str | None = None
    metric_label: str | None = None
    status: str
    trigger_type: str
    triggered: bool
    observed_value: float | None = None
    threshold_value: float
    message: str
    evaluated_at: datetime
    details_json: dict | None = None
    delivery_status: str
    delivery_channel: str | None = None
    delivery_attempted_at: datetime | None = None
    delivery_response_code: int | None = None
    delivery_error: str | None = None

    model_config = {"from_attributes": True}


class MetricAlertListResponse(BaseModel):
    items: list[MetricAlertRead]


class MetricAlertEventListResponse(BaseModel):
    items: list[MetricAlertEventRead]


class MetricAlertEvaluationResponse(BaseModel):
    alert: MetricAlertRead
    event: MetricAlertEventRead


class MetricAlertSweepResponse(BaseModel):
    checked: int
    triggered: int
    errored: int
    events: list[MetricAlertEventRead]


class MetricAlertDeliveryTestRequest(BaseModel):
    notification_channel: str = Field(default="local", pattern="^(local|webhook)$")
    destination: str | None = None


class MetricAlertDeliveryTestResponse(BaseModel):
    delivery_status: str
    delivery_channel: str
    destination: str | None = None
    delivery_response_code: int | None = None
    delivery_error: str | None = None
    message: str


class MetricAlertSchedulerEvaluationRead(BaseModel):
    alert_id: str
    alert_name: str
    event_id: str
    status: str
    triggered: bool


class MetricAlertSchedulerInvalidScheduleRead(BaseModel):
    alert_id: str
    alert_name: str
    cron: str
    reason: str


class MetricAlertSchedulerNextDueRead(BaseModel):
    alert_id: str
    alert_name: str
    cron: str
    next_run_at: str


class MetricAlertSchedulerSweepResponse(BaseModel):
    checked: int
    evaluated: list[MetricAlertSchedulerEvaluationRead] = Field(default_factory=list)
    invalid_schedules: list[MetricAlertSchedulerInvalidScheduleRead] = Field(default_factory=list)
    next_due: list[MetricAlertSchedulerNextDueRead] = Field(default_factory=list)


class MetricAlertSchedulerStatusResponse(BaseModel):
    enabled: bool
    running: bool
    timezone: str
    poll_interval_seconds: int
    last_tick_at: str | None = None
    last_error: str | None = None
    managed_alert_count: int
    last_summary: MetricAlertSchedulerSweepResponse


class ChartCreateRequest(BaseModel):
    name: str
    chart_type: str
    dataset_id: str | None = None
    query_sql: str
    config_json: dict = Field(default_factory=dict)


class ChartUpdateRequest(BaseModel):
    name: str
    chart_type: str
    dataset_id: str | None = None
    query_sql: str
    config_json: dict = Field(default_factory=dict)


class ChartRead(TimestampedModel):
    name: str
    chart_type: str
    dataset_id: str | None = None
    query_sql: str
    config_json: dict

    model_config = {"from_attributes": True}


class NaturalLanguageChartRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=500)
    dataset_id: str | None = None
    limit: int = Field(default=12, ge=1, le=100)


class NaturalLanguageChartResponse(BaseModel):
    name: str
    chart_type: str
    dataset_id: str
    dataset_name: str
    source_ref: str
    query_sql: str
    config_json: dict
    confidence: float
    rationale: list[str]
    assumptions: list[str] = Field(default_factory=list)


class DashboardWidgetPayload(BaseModel):
    id: str | None = None
    chart_id: str | None = None
    widget_type: str
    title: str
    layout_json: dict
    config_json: dict = Field(default_factory=dict)


class DashboardCreateRequest(BaseModel):
    name: str
    description: str | None = None
    layout_json: dict = Field(default_factory=dict)
    filters_json: list[dict] | None = None
    visibility: str = Field(default="workspace", pattern="^(private|workspace|public)$")
    shared_roles_json: list[str] = Field(default_factory=list)
    widgets: list[DashboardWidgetPayload] = Field(default_factory=list)


class DashboardUpdateRequest(BaseModel):
    name: str
    description: str | None = None
    layout_json: dict = Field(default_factory=dict)
    filters_json: list[dict] | None = None
    visibility: str = Field(default="workspace", pattern="^(private|workspace|public)$")
    shared_roles_json: list[str] = Field(default_factory=list)
    widgets: list[DashboardWidgetPayload] = Field(default_factory=list)


class DashboardRead(TimestampedModel):
    name: str
    description: str | None = None
    layout_json: dict
    filters_json: list[dict] | None = None
    owner_email: str | None = None
    visibility: str
    shared_roles_json: list[str] | None = None

    model_config = {"from_attributes": True}


class DashboardWidgetRead(TimestampedModel):
    dashboard_id: str
    chart_id: str | None = None
    widget_type: str
    title: str
    layout_json: dict
    config_json: dict

    model_config = {"from_attributes": True}


class DashboardDetailResponse(BaseModel):
    dashboard: DashboardRead
    widgets: list[DashboardWidgetRead]


class DashboardExportChartPayload(BaseModel):
    source_chart_id: str
    name: str
    chart_type: str
    dataset_id: str | None = None
    query_sql: str
    config_json: dict = Field(default_factory=dict)


class DashboardExportWidgetPayload(BaseModel):
    widget_type: str
    title: str
    layout_json: dict
    config_json: dict = Field(default_factory=dict)
    chart_source_id: str | None = None


class DashboardExportDashboardPayload(BaseModel):
    name: str
    description: str | None = None
    layout_json: dict = Field(default_factory=dict)
    filters_json: list[dict] | None = None
    visibility: str = Field(default="workspace", pattern="^(private|workspace|public)$")
    shared_roles_json: list[str] = Field(default_factory=list)


class DashboardExportPayload(BaseModel):
    version: str = "1.0"
    exported_at: str
    dashboard: DashboardExportDashboardPayload
    widgets: list[DashboardExportWidgetPayload] = Field(default_factory=list)
    charts: list[DashboardExportChartPayload] = Field(default_factory=list)


class DashboardImportRequest(BaseModel):
    config: DashboardExportPayload


class DashboardImportResponse(BaseModel):
    dashboard: DashboardRead
    widgets: list[DashboardWidgetRead]
    imported_charts: list[ChartRead] = Field(default_factory=list)


class DashboardSnapshotRequest(BaseModel):
    format: str = Field(pattern="^(pdf|png)$")


class DashboardSnapshotResponse(BaseModel):
    message: str
    requested_format: str
    dashboard_name: str
    artifact_path: str
    artifact_file_name: str


class ReportScheduleCreateRequest(BaseModel):
    name: str
    dashboard_id: str | None = None
    frequency: str
    destination: str = "local_export"
    config_json: dict = Field(default_factory=dict)


class ReportScheduleRead(TimestampedModel):
    name: str
    dashboard_id: str | None = None
    frequency: str
    destination: str
    config_json: dict

    model_config = {"from_attributes": True}


class ReportScheduleListResponse(BaseModel):
    items: list[ReportScheduleRead]


class ReportSnapshotRead(TimestampedModel):
    schedule_id: str | None = None
    dashboard_id: str | None = None
    schedule_name: str
    dashboard_name: str | None = None
    requested_format: str
    destination: str
    status: str
    artifact_path: str | None = None
    artifact_file_name: str | None = None
    artifact_kind: str | None = None
    error_message: str | None = None
    summary_json: dict | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None

    model_config = {"from_attributes": True}


class ReportSnapshotListResponse(BaseModel):
    items: list[ReportSnapshotRead]


class ReportScheduleExecutionResponse(BaseModel):
    schedule: ReportScheduleRead
    snapshot: ReportSnapshotRead


class ChartPreviewResponse(BaseModel):
    columns: list[str]
    rows: list[dict]
    row_count: int


class DatasetPreviewResponse(BaseModel):
    columns: list[str]
    rows: list[dict]
    row_count: int
    schema_definition: list[dict] | None = Field(default=None, alias="schema_json", serialization_alias="schema_json")

    model_config = {"protected_namespaces": (), "populate_by_name": True}


class DatasetExplorerResponse(BaseModel):
    items: list[SemanticDatasetRead]
    candidates: list[CandidateDatasetRead]


class ChartListResponse(BaseModel):
    items: list[ChartRead]


class ChartTraceabilityDashboardRead(BaseModel):
    dashboard_id: str
    dashboard_name: str
    dashboard_description: str | None = None
    widget_id: str
    widget_title: str
    widget_type: str
    updated_at: str


class ChartTraceabilityReportScheduleRead(BaseModel):
    schedule_id: str
    schedule_name: str
    dashboard_id: str | None = None
    dashboard_name: str | None = None
    frequency: str
    destination: str
    updated_at: str


class ChartTraceabilityResponse(BaseModel):
    chart: ChartRead
    widget_count: int
    dashboard_count: int
    report_schedule_count: int
    dashboards: list[ChartTraceabilityDashboardRead] = Field(default_factory=list)
    report_schedules: list[ChartTraceabilityReportScheduleRead] = Field(default_factory=list)


class DashboardListResponse(BaseModel):
    items: list[DashboardRead]
