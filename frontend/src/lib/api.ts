import { readAuthToken } from '../auth/storage'
import type {
  AuthSession,
  CandidateDataset,
  Chart,
  ChartTraceability,
  Dashboard,
  DashboardExportConfig,
  DashboardImportResult,
  DashboardMetrics,
  DashboardSnapshot,
  DashboardWidget,
  DatasetPreview,
  DeltaTable,
  DemoUser,
  EngineCatalog,
  FilePreview,
  GlobalSearchResult,
  JobLog,
  NotebookCell,
  NotebookCellActionExecution,
  NotebookDetail,
  NotebookDocument,
  NotebookRevisionRestore,
  NotebookRunExecution,
  NotebookSnippet,
  OpenLineageEventEnvelope,
  OpenLineageStatus,
  Pipeline,
  PipelineEdge,
  PipelineNode,
  PipelineRun,
  PipelineRunDetail,
  PipelineScheduleDetail,
  PipelineSchedulerStatus,
  PipelineSchedulerSweep,
  QueryHistory,
  QueryResult,
  QualityExpectation,
  QualityRun,
  QualitySchedulerStatus,
  QualitySchedulerSweep,
  ReportSchedule,
  ReportScheduleExecution,
  ReportSnapshot,
  SemanticDataset,
  SupersetIntegrationStatus,
  TableLineage,
  UploadedFile,
} from '../types'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api').replace(/\/+$/, '')

type ApiMessage = { message: string }
type ListResponse<T> = { items: T[] }
type JsonBody = Record<string, unknown>
type PipelinePayload = {
  name: string
  description?: string
  status?: string
  schedule_cron?: string | null
  definition: { nodes: PipelineNode[]; edges: PipelineEdge[] }
}
type NotebookPayload = {
  name: string
  engine_id: string
  description?: string | null
  cells_json: NotebookCell[]
}

function buildHeaders(body?: BodyInit | null) {
  const headers = new Headers()
  const token = readAuthToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (body && !(body instanceof FormData)) headers.set('Content-Type', 'application/json')
  return headers
}

async function errorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { detail?: unknown; message?: unknown }
    if (typeof payload.detail === 'string') return payload.detail
    if (Array.isArray(payload.detail)) {
      return payload.detail
        .map((item) => (typeof item === 'object' && item && 'msg' in item ? String(item.msg) : String(item)))
        .join('; ')
    }
    if (typeof payload.message === 'string') return payload.message
  } catch {
    // Fall through to the HTTP status when the response is not JSON.
  }
  return `${response.status} ${response.statusText}`.trim()
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: buildHeaders(options.body),
  })
  if (!response.ok) throw new Error(await errorMessage(response))
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

async function requestBlob(path: string, options: RequestInit = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: buildHeaders(options.body),
  })
  if (!response.ok) throw new Error(await errorMessage(response))
  return response.blob()
}

function json(body?: unknown): BodyInit | undefined {
  return body === undefined ? undefined : JSON.stringify(body)
}

function queryString(values: Record<string, string | number | undefined | null>) {
  const params = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  })
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

export const api = {
  login: (payload: { email: string; password: string }) =>
    request<AuthSession>('/system/login', { method: 'POST', body: json(payload) }),
  logout: () => request<ApiMessage>('/system/logout', { method: 'POST' }),
  getCurrentSessionUser: () => request<DemoUser>('/system/me'),
  getDashboardMetrics: () => request<DashboardMetrics>('/system/dashboard-metrics'),
  getSettings: () => request<{ storage: Record<string, unknown>; execution: Record<string, unknown> }>('/system/settings'),
  getOpenLineageStatus: () => request<OpenLineageStatus>('/system/openlineage/status'),
  listOpenLineageEvents: (filters: { event_type?: string; job_name?: string; run_id?: string; limit?: number } = {}) =>
    request<{ items: OpenLineageEventEnvelope[] }>(
      `/system/openlineage/events${queryString(filters)}`,
    ),
  globalSearch: (search: string) =>
    request<{ query: string; items: GlobalSearchResult[] }>(`/system/search${queryString({ q: search })}`),

  listFiles: () => request<ListResponse<UploadedFile>>('/files'),
  uploadFile: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<{ file: UploadedFile; message: string }>('/files/upload', { method: 'POST', body })
  },
  previewFile: (fileId: string) => request<FilePreview>(`/files/${encodeURIComponent(fileId)}/preview`),
  deleteFile: (fileId: string) => request<ApiMessage>(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }),

  listQueryHistory: () => request<ListResponse<QueryHistory>>('/queries/history'),
  executeQuery: (payload: { sql: string; name?: string; limit?: number }) =>
    request<{ query: QueryHistory; result: QueryResult }>('/queries/execute', { method: 'POST', body: json(payload) }),
  exportQuery: (payload: { sql: string; format: 'csv' | 'parquet'; file_name?: string }) =>
    requestBlob('/queries/export', { method: 'POST', body: json(payload) }),
  writeDelta: (payload: { table_name: string; sql: string; mode: 'overwrite' | 'append'; schema_name?: string; description?: string }) =>
    request<{ message: string; table: DeltaTable }>('/queries/write-delta', { method: 'POST', body: json(payload) }),

  listTables: () => request<ListResponse<DeltaTable>>('/tables'),
  previewTable: (tableId: string) =>
    request<{ table: DeltaTable; columns: string[]; rows: Record<string, unknown>[] }>(`/tables/${encodeURIComponent(tableId)}/preview`),
  getTableLineage: (tableId: string) => request<TableLineage>(`/tables/${encodeURIComponent(tableId)}/lineage`),
  updateTableMetadata: (tableId: string, payload: { owner?: string; tags?: string[]; lineage_hint?: string }) =>
    request<DeltaTable>(`/tables/${encodeURIComponent(tableId)}/metadata`, { method: 'PUT', body: json(payload) }),
  updateTableContract: (tableId: string, payload: JsonBody) =>
    request<DeltaTable>(`/tables/${encodeURIComponent(tableId)}/contract`, { method: 'PUT', body: json(payload) }),
  updateTableQualitySuite: (tableId: string, payload: { name: string; expectations: QualityExpectation[] }) =>
    request<DeltaTable>(`/tables/${encodeURIComponent(tableId)}/quality-suite`, { method: 'PUT', body: json(payload) }),
  runTableQualitySuite: (tableId: string) =>
    request<QualityRun>(`/tables/${encodeURIComponent(tableId)}/quality-runs`, { method: 'POST' }),
  listTableQualityRuns: (tableId: string) =>
    request<ListResponse<QualityRun>>(`/tables/${encodeURIComponent(tableId)}/quality-runs`),
  updateTableQualitySchedule: (tableId: string, payload: { cron?: string | null; enabled: boolean }) =>
    request<DeltaTable>(`/tables/${encodeURIComponent(tableId)}/quality-schedule`, { method: 'PUT', body: json(payload) }),
  getQualitySchedulerStatus: () => request<QualitySchedulerStatus>('/tables/quality-scheduler/status'),
  runDueQualitySchedules: () =>
    request<QualitySchedulerSweep>('/tables/quality-scheduler/run-due', { method: 'POST' }),
  refreshTableMetadata: (tableId: string) =>
    request<DeltaTable>(`/tables/${encodeURIComponent(tableId)}/refresh`, { method: 'POST' }),

  listExecutionEngines: () => request<EngineCatalog>('/engines'),
  listNotebooks: () => request<ListResponse<NotebookDocument>>('/engines/notebooks'),
  getNotebook: (notebookId: string) => request<NotebookDetail>(`/engines/notebooks/${encodeURIComponent(notebookId)}`),
  createNotebook: (payload: NotebookPayload) =>
    request<NotebookDocument>('/engines/notebooks', { method: 'POST', body: json(payload) }),
  updateNotebook: (notebookId: string, payload: NotebookPayload) =>
    request<NotebookDocument>(`/engines/notebooks/${encodeURIComponent(notebookId)}`, { method: 'PUT', body: json(payload) }),
  duplicateNotebook: (notebookId: string) =>
    request<NotebookDocument>(`/engines/notebooks/${encodeURIComponent(notebookId)}/duplicate`, { method: 'POST' }),
  deleteNotebook: (notebookId: string) =>
    request<ApiMessage>(`/engines/notebooks/${encodeURIComponent(notebookId)}`, { method: 'DELETE' }),
  runNotebook: (notebookId: string) =>
    request<NotebookRunExecution>(`/engines/notebooks/${encodeURIComponent(notebookId)}/run`, { method: 'POST' }),
  runNotebookCell: (notebookId: string, cellId: string) =>
    request<NotebookCellActionExecution>(
      `/engines/notebooks/${encodeURIComponent(notebookId)}/cells/${encodeURIComponent(cellId)}/run`,
      { method: 'POST' },
    ),
  runNotebookFromCell: (notebookId: string, cellId: string) =>
    request<NotebookCellActionExecution>(
      `/engines/notebooks/${encodeURIComponent(notebookId)}/cells/${encodeURIComponent(cellId)}/run-from-here`,
      { method: 'POST' },
    ),
  restoreNotebookRevision: (notebookId: string, revisionId: string) =>
    request<NotebookRevisionRestore>(
      `/engines/notebooks/${encodeURIComponent(notebookId)}/revisions/${encodeURIComponent(revisionId)}/restore`,
      { method: 'POST' },
    ),
  exportNotebookCell: (notebookId: string, cellId: string, payload: { format: 'csv' | 'parquet'; file_name?: string }) =>
    requestBlob(`/engines/notebooks/${encodeURIComponent(notebookId)}/cells/${encodeURIComponent(cellId)}/export`, {
      method: 'POST',
      body: json(payload),
    }),
  writeNotebookCellDelta: (
    notebookId: string,
    cellId: string,
    payload: { table_name: string; mode: 'overwrite' | 'append'; schema_name: string; description?: string },
  ) =>
    request<{ message: string; table: DeltaTable }>(
      `/engines/notebooks/${encodeURIComponent(notebookId)}/cells/${encodeURIComponent(cellId)}/write-delta`,
      { method: 'POST', body: json(payload) },
    ),
  downloadNotebookArtifact: (artifactId: string) =>
    requestBlob(`/engines/notebooks/artifacts/${encodeURIComponent(artifactId)}/download`),
  listNotebookSnippets: () => request<ListResponse<NotebookSnippet>>('/engines/notebooks/snippets'),
  createNotebookSnippet: (payload: {
    name: string
    description?: string
    category: string
    engine_scope: string
    cell_kind: 'code' | 'markdown'
    code: string
    is_template: boolean
  }) => request<NotebookSnippet>('/engines/notebooks/snippets', { method: 'POST', body: json(payload) }),
  deleteNotebookSnippet: (snippetId: string) =>
    request<ApiMessage>(`/engines/notebooks/snippets/${encodeURIComponent(snippetId)}`, { method: 'DELETE' }),

  listPipelines: () => request<ListResponse<Pipeline>>('/pipelines'),
  createPipeline: (payload: PipelinePayload) =>
    request<Pipeline>('/pipelines', { method: 'POST', body: json(payload) }),
  updatePipeline: (pipelineId: string, payload: PipelinePayload) =>
    request<Pipeline>(`/pipelines/${encodeURIComponent(pipelineId)}`, { method: 'PUT', body: json(payload) }),
  validatePipeline: (pipelineId: string) =>
    request<{ valid: boolean; message: string; ordered_nodes: string[]; issues: string[] }>(
      `/pipelines/${encodeURIComponent(pipelineId)}/validate`,
      { method: 'POST' },
    ),
  runPipeline: (pipelineId: string) =>
    request<{ run: PipelineRun; logs: JobLog[] }>(`/pipelines/${encodeURIComponent(pipelineId)}/run`, { method: 'POST' }),
  retryPipelineRun: (runId: string) =>
    request<{ run: PipelineRun; logs: JobLog[] }>(`/pipelines/runs/${encodeURIComponent(runId)}/retry`, { method: 'POST' }),
  listRuns: (filters: { pipeline_id?: string; trigger_type?: string } = {}) =>
    request<ListResponse<PipelineRun>>(`/pipelines/runs/all${queryString(filters)}`),
  getRunDetails: (runId: string) => request<PipelineRunDetail>(`/pipelines/runs/${encodeURIComponent(runId)}`),
  listLogs: (filters: { run_id?: string; node_id?: string; status?: string } = {}) =>
    request<ListResponse<JobLog>>(`/pipelines/logs/all${queryString(filters)}`),
  getAirflowDag: (pipelineId: string) =>
    request<{ pipeline_id: string; code: string }>(`/pipelines/${encodeURIComponent(pipelineId)}/airflow-dag`),
  getPipelineSchedulerStatus: () => request<PipelineSchedulerStatus>('/pipelines/scheduler/status'),
  runDuePipelineSchedules: () => request<PipelineSchedulerSweep>('/pipelines/scheduler/run-due', { method: 'POST' }),
  getPipelineScheduleDetail: (pipelineId: string) =>
    request<PipelineScheduleDetail>(`/pipelines/${encodeURIComponent(pipelineId)}/scheduler`),
  pausePipelineSchedule: (pipelineId: string) =>
    request<Pipeline>(`/pipelines/${encodeURIComponent(pipelineId)}/scheduler/pause`, { method: 'POST' }),
  resumePipelineSchedule: (pipelineId: string) =>
    request<Pipeline>(`/pipelines/${encodeURIComponent(pipelineId)}/scheduler/resume`, { method: 'POST' }),

  listDatasets: () => request<{ items: SemanticDataset[]; candidates: CandidateDataset[] }>('/bi/datasets'),
  createDataset: (payload: JsonBody) =>
    request<SemanticDataset>('/bi/datasets', { method: 'POST', body: json(payload) }),
  updateDataset: (datasetId: string, payload: JsonBody) =>
    request<SemanticDataset>(`/bi/datasets/${encodeURIComponent(datasetId)}`, { method: 'PUT', body: json(payload) }),
  previewDataset: (datasetId: string) => request<DatasetPreview>(`/bi/datasets/${encodeURIComponent(datasetId)}/preview`),
  previewDatasetCandidate: (candidateId: string) =>
    request<DatasetPreview>(`/bi/datasets/candidates/${encodeURIComponent(candidateId)}/preview`),
  listCharts: () => request<ListResponse<Chart>>('/bi/charts'),
  createChart: (payload: JsonBody) => request<Chart>('/bi/charts', { method: 'POST', body: json(payload) }),
  updateChart: (chartId: string, payload: JsonBody) =>
    request<Chart>(`/bi/charts/${encodeURIComponent(chartId)}`, { method: 'PUT', body: json(payload) }),
  deleteChart: (chartId: string) => request<ApiMessage>(`/bi/charts/${encodeURIComponent(chartId)}`, { method: 'DELETE' }),
  previewChart: (payload: { sql: string; limit?: number }) =>
    request<{ columns: string[]; rows: Record<string, unknown>[]; row_count: number }>('/bi/charts/preview', {
      method: 'POST',
      body: json(payload),
    }),
  getChartTraceability: (chartId: string) =>
    request<ChartTraceability>(`/bi/charts/${encodeURIComponent(chartId)}/traceability`),
  listDashboards: () => request<ListResponse<Dashboard>>('/bi/dashboards'),
  getDashboard: (dashboardId: string) =>
    request<{ dashboard: Dashboard; widgets: DashboardWidget[] }>(`/bi/dashboards/${encodeURIComponent(dashboardId)}`),
  createDashboard: (payload: JsonBody) =>
    request<{ dashboard: Dashboard; widgets: DashboardWidget[] }>('/bi/dashboards', { method: 'POST', body: json(payload) }),
  updateDashboard: (dashboardId: string, payload: JsonBody) =>
    request<{ dashboard: Dashboard; widgets: DashboardWidget[] }>(`/bi/dashboards/${encodeURIComponent(dashboardId)}`, {
      method: 'PUT',
      body: json(payload),
    }),
  exportDashboard: (dashboardId: string) => requestBlob(`/bi/dashboards/${encodeURIComponent(dashboardId)}/export`),
  importDashboard: (payload: { config: DashboardExportConfig }) =>
    request<DashboardImportResult>('/bi/dashboards/import', { method: 'POST', body: json(payload) }),
  createDashboardSnapshot: (dashboardId: string, payload: { format: 'pdf' | 'png' }) =>
    request<DashboardSnapshot>(`/bi/dashboards/${encodeURIComponent(dashboardId)}/snapshots`, {
      method: 'POST',
      body: json(payload),
    }),
  createReportSchedule: (payload: JsonBody) =>
    request<ReportSchedule>('/bi/report-schedules', { method: 'POST', body: json(payload) }),
  listReportSchedules: () => request<ListResponse<ReportSchedule>>('/bi/report-schedules'),
  runReportSchedule: (scheduleId: string) =>
    request<ReportScheduleExecution>(`/bi/report-schedules/${encodeURIComponent(scheduleId)}/run`, { method: 'POST' }),
  listReportSnapshots: () => request<ListResponse<ReportSnapshot>>('/bi/report-snapshots'),
  deleteReportSchedule: (scheduleId: string) =>
    request<ApiMessage>(`/bi/report-schedules/${encodeURIComponent(scheduleId)}`, { method: 'DELETE' }),

  getSupersetIntegrationStatus: () => request<SupersetIntegrationStatus>('/system/integrations/superset'),
  getSupersetEmbedLaunchUrl: (next = '/superset/welcome/') =>
    request<{ launch_url: string }>(`/system/integrations/superset/embed-launch${queryString({ next })}`, { method: 'POST' }),
  syncSupersetServingCatalog: () =>
    request<SupersetIntegrationStatus>('/system/integrations/superset/sync', { method: 'POST' }),
  provisionSupersetConnection: () =>
    request<SupersetIntegrationStatus>('/system/integrations/superset/provision', { method: 'POST' }),
}
