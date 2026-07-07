export type UploadedFile = {
  id: string
  name: string
  storage_path: string
  file_type: string
  size_bytes: number
  schema_json?: { name: string; type: string }[]
  row_count?: number
  source: string
  created_at: string
  updated_at: string
}

export type FileProfileSummary = {
  total_rows: number
  distinct_rows: number
  duplicate_rows: number
  duplicate_ratio: number
  total_columns: number
  total_blank_cells: number
  null_cells: number
  completeness_ratio: number
  columns_with_nulls: number
  columns_with_blank_values: number
  quality_indicators: string[]
}

export type FileColumnTopValue = {
  value: string
  count: number
}

export type FileColumnProfile = {
  name: string
  type: string
  profile_kind: 'numeric' | 'temporal' | 'boolean' | 'string' | 'other'
  null_count: number
  non_null_count: number
  distinct_count: number
  blank_count: number
  completeness_ratio: number
  uniqueness_ratio: number
  cardinality_band: 'empty' | 'constant' | 'low' | 'medium' | 'high' | 'unique'
  sample_values: string[]
  top_values: FileColumnTopValue[]
  min_value?: string | null
  max_value?: string | null
  avg_value?: number | null
  stddev_value?: number | null
  true_count?: number | null
  false_count?: number | null
  quality_indicators: string[]
}

export type FileRecommendationItem = {
  column: string
  label: string
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
}

export type FileRecommendations = {
  join_keys: FileRecommendationItem[]
  dimensions: FileRecommendationItem[]
  metrics: FileRecommendationItem[]
  time_columns: FileRecommendationItem[]
  quality_actions: string[]
}

export type FilePreview = {
  file: UploadedFile
  columns: string[]
  rows: Record<string, unknown>[]
  profile_summary: FileProfileSummary
  column_profiles: FileColumnProfile[]
  recommendations: FileRecommendations
}

export type QualityExpectation = {
  id: string
  expectation_type: 'row_count_between' | 'not_null' | 'unique' | 'accepted_values'
  enabled: boolean
  severity: 'warning' | 'error'
  column?: string | null
  min_value?: number | null
  max_value?: number | null
  accepted_values?: string[] | null
}

export type QualityExpectationResult = {
  id: string
  expectation_type: QualityExpectation['expectation_type']
  column?: string | null
  severity: 'warning' | 'error'
  success: boolean
  observed_value?: unknown
  unexpected_count: number
  unexpected_percent: number
  detail: string
}

export type QualityRun = {
  id: string
  table_id: string
  pipeline_run_id?: string | null
  node_id?: string | null
  suite_name: string
  execution_engine: 'native' | 'great_expectations' | string
  trigger_type: 'manual' | 'scheduled' | 'pipeline_gate' | string
  status: 'passed' | 'warning' | 'failed'
  success: boolean
  row_count: number
  expectation_count: number
  passed_count: number
  failed_count: number
  summary: string
  results_json: QualityExpectationResult[]
  started_at: string
  finished_at: string
  duration_ms: number
}

export type QualityEngineStatus = {
  default_engine: string
  engines: {
    name: 'native' | 'great_expectations' | string
    label: string
    available: boolean
    version?: string | null
    detail: string
  }[]
}

export type QualitySchedulerSweep = {
  checked: number
  triggered: { table_id: string; table_name: string; quality_run_id: string; status: string }[]
  invalid_schedules: { table_id: string; table_name: string; cron: string; reason: string }[]
  next_due: { table_id: string; table_name: string; cron: string; next_run_at: string }[]
}

export type QualitySchedulerStatus = {
  enabled: boolean
  running: boolean
  timezone: string
  poll_interval_seconds: number
  last_tick_at?: string | null
  last_error?: string | null
  managed_table_count: number
  last_summary: QualitySchedulerSweep
}

export type AccessPolicyRowFilter = {
  id?: string | null
  role: 'all' | 'admin' | 'analyst' | 'viewer'
  expression: string
  enabled: boolean
}

export type AccessPolicyColumnMask = {
  id?: string | null
  role: 'all' | 'admin' | 'analyst' | 'viewer'
  column: string
  mask_type: 'null' | 'fixed' | 'hash' | 'partial'
  replacement?: string | null
  enabled: boolean
}

export type DeltaTable = {
  id: string
  name: string
  schema_name: string
  storage_path: string
  description?: string
  schema_json?: { name: string; type: string }[]
  mode: string
  source_query?: string
  row_count?: number
  last_refreshed_at?: string
  owner?: string
  tags?: string[]
  freshness_status?: string
  lineage_hint?: string
  governance_score?: number
  governance_grade?: string
  governance_status?: string
  governance_summary?: string
  governance_strengths?: string[]
  governance_gaps?: string[]
  governance_breakdown?: {
    key: string
    label: string
    max_points: number
    earned_points: number
    status: 'strong' | 'partial' | 'missing'
    detail: string
  }[]
  contract_mode?: 'off' | 'warn' | 'strict'
  contract_version?: number
  contract_schema_json?: { name: string; type: string }[]
  contract_required_columns?: string[]
  contract_allow_additive_columns?: boolean
  contract_allow_column_removal?: boolean
  contract_allow_type_changes?: boolean
  contract_last_check_status?: 'pass' | 'warning' | 'blocked' | 'untracked'
  contract_last_check_summary?: string
  contract_last_check_issues?: string[]
  contract_last_check_at?: string | null
  quality_suite_name?: string
  quality_expectations?: QualityExpectation[]
  quality_last_run_status?: 'passed' | 'warning' | 'failed' | 'untracked'
  quality_last_run_summary?: string
  quality_last_run_at?: string | null
  quality_last_run_results?: QualityExpectationResult[]
  quality_execution_engine?: 'native' | 'great_expectations'
  quality_schedule_cron?: string | null
  quality_schedule_enabled?: boolean
  quality_schedule_updated_at?: string | null
  access_policy_mode?: 'off' | 'warn' | 'enforce'
  access_policy_updated_at?: string | null
  row_filters?: AccessPolicyRowFilter[]
  column_masks?: AccessPolicyColumnMask[]
  created_at: string
  updated_at: string
}

export type TableLineage = {
  table_id: string
  table_name: string
  schema_name: string
  upstream: {
    kind: string
    label: string
    pipeline_id?: string | null
    pipeline_name?: string | null
    node_id?: string | null
    schedule_cron?: string | null
    notebook_id?: string | null
    notebook_name?: string | null
    cell_id?: string | null
    cell_title?: string | null
    artifact_id?: string | null
    engine_id?: string | null
    source_query?: string | null
  }
  related_pipelines: {
    pipeline_id: string
    pipeline_name: string
    node_id?: string | null
    schedule_cron?: string | null
    updated_at: string
  }[]
  notebook_artifacts: {
    artifact_id: string
    notebook_id: string
    cell_id: string
    cell_title?: string | null
    artifact_kind: string
    display_name: string
    row_count?: number | null
    created_at: string
  }[]
  semantic_datasets: {
    dataset_id: string
    dataset_name: string
    metrics_count: number
    dimensions_count: number
    updated_at: string
  }[]
  charts: {
    chart_id: string
    chart_name: string
    chart_type: string
    dataset_id?: string | null
    updated_at: string
  }[]
  dashboards: {
    dashboard_id: string
    dashboard_name: string
    dashboard_description?: string | null
    updated_at: string
  }[]
  report_schedules: {
    schedule_id: string
    schedule_name: string
    dashboard_id?: string | null
    frequency: string
    destination: string
    updated_at: string
  }[]
  counts: {
    semantic_datasets: number
    charts: number
    dashboards: number
    report_schedules: number
    related_pipelines: number
    notebook_artifacts: number
  }
  impact_analysis: {
    severity: string
    score: number
    total_downstream_assets: number
    business_exposure: string
    orchestration_exposure: string
    notebook_exposure: string
    safe_change_summary: string
    recommended_checks: string[]
    highest_risk_assets: {
      kind: string
      asset_id?: string | null
      label: string
      secondary_label?: string | null
      reason: string
      severity: string
      route_ref?: string | null
    }[]
  }
}

export type QueryHistory = {
  id: string
  name?: string
  sql_text: string
  status: string
  execution_ms?: number
  row_count?: number
  result_preview?: Record<string, unknown>[]
  error_message?: string
  created_at: string
  updated_at: string
}

export type PipelineNode = {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

export type PipelineEdge = {
  id: string
  source: string
  target: string
}

export type Pipeline = {
  id: string
  name: string
  description?: string
  status: string
  schedule_cron?: string
  next_run_at?: string | null
  definition_json: { nodes: PipelineNode[]; edges: PipelineEdge[] }
  created_at: string
  updated_at: string
}

export type PipelineRun = {
  id: string
  pipeline_id: string
  pipeline_name?: string
  status: string
  started_at?: string
  finished_at?: string
  duration_ms?: number
  trigger_type: string
  error_message?: string
  run_summary?: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type JobLog = {
  id: string
  pipeline_run_id?: string
  query_id?: string
  level: string
  source: string
  message: string
  status?: string
  context_json?: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type DemoUser = {
  name: string
  email: string
  role: string
}

export type AuthSession = {
  token: string
  user: DemoUser
}

export type GlobalSearchResult = {
  id: string
  kind: string
  title: string
  subtitle: string
  route: string
  updated_at: string
}

export type OpenLineageDataset = {
  namespace: string
  name: string
  facets: Record<string, unknown>
}

export type OpenLineageEvent = {
  eventType: 'START' | 'COMPLETE' | 'FAIL' | string
  eventTime: string
  run: { runId: string; facets: Record<string, unknown> }
  job: { namespace: string; name: string; facets: Record<string, unknown> }
  inputs: OpenLineageDataset[]
  outputs: OpenLineageDataset[]
  producer: string
  schemaURL: string
}

export type OpenLineageEventEnvelope = {
  event: OpenLineageEvent
  delivery: {
    status: 'local_only' | 'delivered' | 'failed'
    http_status?: number | null
    detail: string
  }
  storage?: { status: 'failed'; detail: string }
}

export type OpenLineageStatus = {
  enabled: boolean
  namespace: string
  transport_mode: 'local' | 'http'
  transport_url?: string | null
  events_path: string
  event_count: number
  delivery_failures: number
  latest_event_at?: string | null
}

export type PipelineRunDetail = {
  run: PipelineRun
  pipeline?: Pipeline
  logs: JobLog[]
}

export type PipelineSchedulerSweep = {
  checked: number
  triggered: { pipeline_id: string; pipeline_name: string; run_id: string; status: string }[]
  invalid_schedules: { pipeline_id: string; pipeline_name: string; cron: string; reason: string }[]
  next_due: { pipeline_id: string; pipeline_name: string; cron: string; next_run_at: string }[]
}

export type PipelineSchedulerStatus = {
  enabled: boolean
  running: boolean
  timezone: string
  poll_interval_seconds: number
  last_tick_at?: string | null
  last_error?: string | null
  managed_pipeline_count: number
  last_summary: PipelineSchedulerSweep
}

export type PipelineScheduleDetail = {
  pipeline: Pipeline
  scheduler_state: string
  next_run_at?: string | null
  last_scheduled_run_at?: string | null
  recent_scheduled_runs: PipelineRun[]
}

export type SemanticDataset = {
  id: string
  name: string
  source_type: string
  source_ref: string
  source_config_json?: Record<string, unknown>
  description?: string
  schema_json?: { name: string; type: string }[]
  metrics_json?: Record<string, unknown>[]
  dimensions_json?: Record<string, unknown>[]
  created_at: string
  updated_at: string
}

export type CandidateDataset = {
  id: string
  name: string
  schema_name?: string
  source_type: string
  source_ref: string
  description?: string
  schema_json?: { name: string; type: string }[]
  row_count?: number
  updated_at?: string
}

export type DatasetPreview = {
  columns: string[]
  rows: Record<string, unknown>[]
  row_count: number
  schema_json?: { name: string; type: string }[]
}

export type SemanticMetric = {
  id: string
  name: string
  label: string
  description?: string | null
  dataset_id: string
  dataset_name?: string | null
  source_ref?: string | null
  expression: string
  filter_sql?: string | null
  dimensions_json?: string[] | null
  format: string
  owner_email?: string | null
  is_certified: boolean
  created_at: string
  updated_at: string
}

export type SemanticMetricPreview = {
  metric: SemanticMetric
  sql: string
  columns: string[]
  rows: Record<string, unknown>[]
  row_count: number
}

export type MetricAlert = {
  id: string
  name: string
  metric_id: string
  metric_name?: string | null
  metric_label?: string | null
  dataset_name?: string | null
  source_ref?: string | null
  comparison: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq'
  threshold_value: number
  severity: 'info' | 'warning' | 'critical'
  enabled: boolean
  owner_email?: string | null
  notification_channel: 'local' | 'webhook' | string
  destination?: string | null
  last_status: 'not_evaluated' | 'ok' | 'triggered' | 'error' | string
  last_value?: number | null
  last_message?: string | null
  last_evaluated_at?: string | null
  schedule_cron?: string | null
  schedule_enabled: boolean
  schedule_updated_at?: string | null
  created_at: string
  updated_at: string
}

export type MetricAlertEvent = {
  id: string
  alert_id: string
  alert_name?: string | null
  metric_id?: string | null
  metric_label?: string | null
  status: 'ok' | 'triggered' | 'error' | string
  trigger_type: 'manual' | 'scheduled' | string
  triggered: boolean
  observed_value?: number | null
  threshold_value: number
  message: string
  evaluated_at: string
  details_json?: Record<string, unknown> | null
  delivery_status: 'not_attempted' | 'skipped' | 'delivered' | 'failed' | string
  delivery_channel?: 'local' | 'webhook' | string | null
  delivery_attempted_at?: string | null
  delivery_response_code?: number | null
  delivery_error?: string | null
  created_at: string
  updated_at: string
}

export type MetricAlertEvaluation = {
  alert: MetricAlert
  event: MetricAlertEvent
}

export type MetricAlertSweep = {
  checked: number
  triggered: number
  errored: number
  events: MetricAlertEvent[]
}

export type MetricAlertSchedulerSweep = {
  checked: number
  evaluated: {
    alert_id: string
    alert_name: string
    event_id: string
    status: string
    triggered: boolean
  }[]
  invalid_schedules: {
    alert_id: string
    alert_name: string
    cron: string
    reason: string
  }[]
  next_due: {
    alert_id: string
    alert_name: string
    cron: string
    next_run_at: string
  }[]
}

export type MetricAlertSchedulerStatus = {
  enabled: boolean
  running: boolean
  timezone: string
  poll_interval_seconds: number
  last_tick_at?: string | null
  last_error?: string | null
  managed_alert_count: number
  last_summary: MetricAlertSchedulerSweep
}

export type Chart = {
  id: string
  name: string
  chart_type: string
  dataset_id?: string
  query_sql: string
  config_json: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type GeneratedChart = {
  name: string
  chart_type: 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'timeseries' | 'kpi' | string
  dataset_id: string
  dataset_name: string
  source_ref: string
  query_sql: string
  config_json: Record<string, unknown>
  confidence: number
  rationale: string[]
  assumptions: string[]
}

export type ChartTraceability = {
  chart: Chart
  widget_count: number
  dashboard_count: number
  report_schedule_count: number
  dashboards: {
    dashboard_id: string
    dashboard_name: string
    dashboard_description?: string
    widget_id: string
    widget_title: string
    widget_type: string
    updated_at: string
  }[]
  report_schedules: {
    schedule_id: string
    schedule_name: string
    dashboard_id?: string
    dashboard_name?: string
    frequency: string
    destination: string
    updated_at: string
  }[]
}

export type Dashboard = {
  id: string
  name: string
  description?: string
  layout_json: Record<string, unknown>
  filters_json?: Record<string, unknown>[]
  owner_email?: string | null
  visibility: 'private' | 'workspace' | 'public'
  shared_roles_json?: string[] | null
  created_at: string
  updated_at: string
}

export type DashboardWidget = {
  id: string
  dashboard_id: string
  chart_id?: string
  widget_type: string
  title: string
  layout_json: { i?: string; x: number; y: number; w: number; h: number }
  config_json: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type DashboardExportChart = {
  source_chart_id: string
  name: string
  chart_type: string
  dataset_id?: string
  query_sql: string
  config_json: Record<string, unknown>
}

export type DashboardExportWidget = {
  widget_type: string
  title: string
  layout_json: Record<string, unknown>
  config_json: Record<string, unknown>
  chart_source_id?: string
}

export type DashboardExportConfig = {
  version: string
  exported_at: string
  dashboard: {
    name: string
    description?: string
    layout_json: Record<string, unknown>
    filters_json?: Record<string, unknown>[]
    visibility: 'private' | 'workspace' | 'public'
    shared_roles_json?: string[]
  }
  widgets: DashboardExportWidget[]
  charts: DashboardExportChart[]
}

export type DashboardImportResult = {
  dashboard: Dashboard
  widgets: DashboardWidget[]
  imported_charts: Chart[]
}

export type DashboardSnapshot = {
  message: string
  requested_format: string
  dashboard_name: string
  artifact_path: string
  artifact_file_name: string
}

export type DashboardMetrics = {
  total_files: number
  total_delta_tables: number
  total_pipeline_runs: number
  failed_jobs: number
  storage_usage_bytes: number
  recent_activity: {
    id: string
    kind: string
    title: string
    status: string
    created_at: string
  }[]
}

export type SupersetIntegrationStatus = {
  status: string
  reachable: boolean
  checked_url: string
  http_status?: number
  detail?: string
  login: {
    ui_url: string
    username: string
    password: string
  }
  serving_catalog: {
    catalog_status: string
    last_synced_at?: string | null
    last_sync_reason?: string | null
    last_error?: string | null
    database_path: string
    host_sqlalchemy_uri: string
    container_sqlalchemy_uri: string
    asset_counts: {
      raw_files: number
      curated_tables: number
      semantic_datasets: number
      total: number
    }
    schemas: string[]
    assets: {
      asset_kind: string
      object_schema: string
      object_name: string
      display_name: string
      source_type: string
      source_ref: string
      description?: string | null
      row_count?: number | null
      updated_at?: string | null
    }[]
  }
  auto_connection: {
    name: string
    runtime_mode: string
    expected_sqlalchemy_uri: string
    database_path?: string | null
    provisioned: boolean
    database_id?: number | null
    found_sqlalchemy_uri?: string | null
    backend?: string | null
    expose_in_sqllab?: boolean | null
  }
  sample_connections: {
    label: string
    purpose: string
    sqlalchemy_uri: string
  }[]
  sample_datasets: {
    name: string
    schema: string
    description: string
    asset_kind?: string
    display_name?: string
  }[]
  setup: {
    compose_command: string
    local_command?: string
    auto_command?: string
    native_command?: string
    profile: string
    embedded_ui_path?: string
    notes: string[]
  }
}

export type QueryResult = {
  columns: string[]
  rows: Record<string, unknown>[]
  row_count: number
  execution_ms: number
}

export type ExecutionEngine = {
  id: string
  label: string
  vendor: string
  runtime_language: string
  available: boolean
  status: string
  summary: string
  description: string
  availability_reason?: string
  supports_sql: boolean
  supports_python: boolean
  supports_delta_read: boolean
  supports_delta_write: boolean
  supports_local_files: boolean
  notebook_ready: boolean
  sample_code: string
}

export type EngineCatalog = {
  default_engine: string
  items: ExecutionEngine[]
}

export type NotebookExecutionResult = {
  engine_id: string
  engine_label: string
  status: string
  language: string
  execution_ms: number
  columns: string[]
  rows: Record<string, unknown>[]
  row_count: number
  stdout?: string | null
  message?: string | null
  warnings: string[]
  metadata: Record<string, unknown>
}

export type NotebookExecutionResponse = {
  engine: ExecutionEngine
  result: NotebookExecutionResult
}

export type NotebookCell = {
  id: string
  title?: string | null
  kind?: 'code' | 'markdown'
  code: string
}

export type NotebookDocument = {
  id: string
  name: string
  engine_id: string
  description?: string | null
  cells_json: NotebookCell[]
  latest_cell_results_json?: NotebookCellRunResult[]
  last_run_at?: string | null
  created_at: string
  updated_at: string
}

export type NotebookRun = {
  id: string
  notebook_id: string
  engine_id: string
  status: string
  started_at?: string | null
  finished_at?: string | null
  duration_ms?: number | null
  error_message?: string | null
  run_summary?: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type NotebookRevision = {
  id: string
  notebook_id: string
  version_number: number
  action: string
  snapshot_json: {
    name?: string
    engine_id?: string
    description?: string | null
    cells_json?: NotebookCell[]
  }
  summary_json?: {
    cell_count?: number
    code_cells?: number
    markdown_cells?: number
    titled_cells?: number
  } | null
  created_at: string
  updated_at: string
}

export type NotebookArtifact = {
  id: string
  notebook_id: string
  notebook_run_id?: string | null
  delta_table_id?: string | null
  cell_id: string
  cell_title?: string | null
  artifact_kind: string
  display_name: string
  storage_path: string
  download_name?: string | null
  row_count?: number | null
  metadata_json?: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type NotebookEvent = {
  id: string
  notebook_id: string
  notebook_run_id?: string | null
  artifact_id?: string | null
  action: string
  actor_name: string
  actor_email: string
  actor_role: string
  message: string
  metadata_json?: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type NotebookCellRunResult = {
  cell_id: string
  title?: string | null
  status: string
  execution_ms: number
  columns: string[]
  rows: Record<string, unknown>[]
  row_count: number
  stdout?: string | null
  message?: string | null
  warnings: string[]
}

export type NotebookDetail = {
  notebook: NotebookDocument
  recent_events: NotebookEvent[]
  recent_revisions: NotebookRevision[]
  recent_runs: NotebookRun[]
  recent_artifacts: NotebookArtifact[]
}

export type NotebookRunExecution = {
  notebook: NotebookDocument
  run: NotebookRun
  cell_results: NotebookCellRunResult[]
}

export type NotebookCellActionExecution = {
  notebook: NotebookDocument
  run: NotebookRun
  cell_results: NotebookCellRunResult[]
  mode: string
  start_cell_id: string
}

export type NotebookRevisionRestore = {
  notebook: NotebookDocument
  revision: NotebookRevision
  message: string
}

export type NotebookSnippet = {
  id: string
  name: string
  description?: string
  category: string
  engine_scope: string
  cell_kind: 'code' | 'markdown'
  code: string
  is_template: boolean
  created_at: string
  updated_at: string
}

export type ReportSchedule = {
  id: string
  name: string
  dashboard_id?: string
  frequency: string
  destination: string
  config_json: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type ReportSnapshot = {
  id: string
  schedule_id?: string
  dashboard_id?: string
  schedule_name: string
  dashboard_name?: string
  requested_format: string
  destination: string
  status: string
  artifact_path?: string
  artifact_file_name?: string
  artifact_kind?: string
  error_message?: string
  summary_json?: Record<string, unknown>
  started_at?: string
  finished_at?: string
  created_at: string
  updated_at: string
}

export type ReportScheduleExecution = {
  schedule: ReportSchedule
  snapshot: ReportSnapshot
}
