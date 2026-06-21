import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/auth-context'
import { DataTable } from '../components/data-table'
import { Button, EmptyState, Input, Label, PageHeader, Panel, Select, StatCard, Textarea } from '../components/ui'
import { api } from '../lib/api'
import { useTheme } from '../theme/theme-context'
import { cn, formatDate } from '../lib/utils'

type LineageFocus = 'upstream' | 'pipelines' | 'notebooks' | 'datasets' | 'charts' | 'dashboards' | 'reports'

function freshnessTone(status?: string) {
  if (status === 'fresh') return 'bg-emerald-50 text-emerald-700'
  if (status === 'aging') return 'bg-amber-50 text-amber-700'
  if (status === 'stale') return 'bg-rose-50 text-rose-700'
  return 'bg-slate-100 text-slate-700'
}

function governanceTone(status?: string) {
  if (status === 'excellent' || status === 'healthy') return 'bg-emerald-50 text-emerald-700'
  if (status === 'developing') return 'bg-amber-50 text-amber-700'
  if (status === 'at_risk' || status === 'weak') return 'bg-rose-50 text-rose-700'
  return 'bg-slate-100 text-slate-700'
}

function lineageGraphTone(theme: 'light' | 'dark', active: boolean) {
  if (theme === 'dark') {
    return active
      ? 'border-cyan-400/30 bg-cyan-400/10 text-white'
      : 'border-white/10 bg-white/[0.03] text-white/55'
  }
  return active
    ? 'border-cyan-200 bg-cyan-50 text-slate-900'
    : 'border-slate-200 bg-slate-50 text-slate-500'
}

function lineageFocusTone(theme: 'light' | 'dark', active: boolean) {
  if (theme === 'dark') {
    return active
      ? 'border-[#f6f24a]/35 bg-[#f6f24a]/12 text-white shadow-[0_0_0_1px_rgba(246,242,74,0.12)]'
      : 'border-white/10 bg-white/[0.03] text-white/60'
  }
  return active
    ? 'border-lagoon/20 bg-cyan-50 text-slate-900 shadow-sm'
    : 'border-slate-200 bg-slate-50 text-slate-500'
}

function impactSeverityTone(severity?: string) {
  if (severity === 'critical') return 'bg-rose-50 text-rose-700'
  if (severity === 'high') return 'bg-amber-50 text-amber-700'
  if (severity === 'medium') return 'bg-cyan-50 text-lagoon'
  return 'bg-emerald-50 text-emerald-700'
}

function impactSeverityLabel(severity?: string) {
  return severity ? severity.replace(/_/g, ' ') : 'low'
}

function contractModeTone(mode?: string) {
  if (mode === 'strict') return 'bg-rose-50 text-rose-700'
  if (mode === 'warn') return 'bg-amber-50 text-amber-700'
  if (mode === 'off') return 'bg-slate-100 text-slate-700'
  return 'bg-cyan-50 text-lagoon'
}

function contractCheckTone(status?: string) {
  if (status === 'pass') return 'bg-emerald-50 text-emerald-700'
  if (status === 'warning') return 'bg-amber-50 text-amber-700'
  if (status === 'blocked') return 'bg-rose-50 text-rose-700'
  return 'bg-slate-100 text-slate-700'
}

function qualityTone(status?: string) {
  if (status === 'passed') return 'bg-emerald-50 text-emerald-700'
  if (status === 'warning') return 'bg-amber-50 text-amber-700'
  if (status === 'failed') return 'bg-rose-50 text-rose-700'
  return 'bg-slate-100 text-slate-700'
}

function commaSeparatedValues(value: string) {
  return Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean)))
}

export function CatalogPage() {
  const { hasAnyRole } = useAuth()
  const canEdit = hasAnyRole('admin', 'analyst')
  const { theme } = useTheme()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [schemaFilter, setSchemaFilter] = useState('all')
  const [ownerDraft, setOwnerDraft] = useState('')
  const [tagsDraft, setTagsDraft] = useState('')
  const [lineageDraft, setLineageDraft] = useState('')
  const [contractModeDraft, setContractModeDraft] = useState<'off' | 'warn' | 'strict'>('warn')
  const [contractRequiredColumnsDraft, setContractRequiredColumnsDraft] = useState('')
  const [contractAllowAdditiveDraft, setContractAllowAdditiveDraft] = useState(true)
  const [contractAllowRemovalDraft, setContractAllowRemovalDraft] = useState(false)
  const [contractAllowTypeDraft, setContractAllowTypeDraft] = useState(false)
  const [qualitySuiteNameDraft, setQualitySuiteNameDraft] = useState('')
  const [qualityMinRowsDraft, setQualityMinRowsDraft] = useState('1')
  const [qualityNotNullDraft, setQualityNotNullDraft] = useState('')
  const [qualityUniqueDraft, setQualityUniqueDraft] = useState('')
  const [qualityScheduleCronDraft, setQualityScheduleCronDraft] = useState('')
  const [qualityScheduleEnabledDraft, setQualityScheduleEnabledDraft] = useState(false)
  const [lineageFocus, setLineageFocus] = useState<LineageFocus>('upstream')
  const [statusMessage, setStatusMessage] = useState('Select a curated table to inspect governance metadata, ownership, freshness, and lineage hints.')
  const appliedSearchTableIdRef = useRef<string | null>(null)
  const tablesQuery = useQuery({ queryKey: ['tables'], queryFn: api.listTables })
  const previewQuery = useQuery({
    queryKey: ['tables', selectedTableId, 'preview'],
    queryFn: () => api.previewTable(selectedTableId!),
    enabled: Boolean(selectedTableId),
  })
  const lineageQuery = useQuery({
    queryKey: ['tables', selectedTableId, 'lineage'],
    queryFn: () => api.getTableLineage(selectedTableId!),
    enabled: Boolean(selectedTableId),
  })
  const qualityRunsQuery = useQuery({
    queryKey: ['tables', selectedTableId, 'quality-runs'],
    queryFn: () => api.listTableQualityRuns(selectedTableId!),
    enabled: Boolean(selectedTableId),
  })
  const qualitySchedulerQuery = useQuery({
    queryKey: ['quality-scheduler'],
    queryFn: api.getQualitySchedulerStatus,
    refetchInterval: 15000,
  })
  const updateMetadataMutation = useMutation({
    mutationFn: async (payload: { tableId: string; owner?: string; tags?: string[]; lineage_hint?: string }) =>
      api.updateTableMetadata(payload.tableId, { owner: payload.owner, tags: payload.tags, lineage_hint: payload.lineage_hint }),
    onSuccess: (table) => {
      queryClient.invalidateQueries({ queryKey: ['tables'] })
      queryClient.invalidateQueries({ queryKey: ['tables', table.id, 'preview'] })
      setStatusMessage(`Updated catalog governance metadata for ${table.schema_name}.${table.name}.`)
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })
  const refreshMutation = useMutation({
    mutationFn: api.refreshTableMetadata,
    onSuccess: (table) => {
      queryClient.invalidateQueries({ queryKey: ['tables'] })
      queryClient.invalidateQueries({ queryKey: ['tables', table.id, 'preview'] })
      setStatusMessage(`Refreshed metadata for ${table.schema_name}.${table.name}.`)
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })
  const updateContractMutation = useMutation({
    mutationFn: async (payload: {
      tableId: string
      contract_mode: 'off' | 'warn' | 'strict'
      contract_required_columns?: string[]
      contract_allow_additive_columns: boolean
      contract_allow_column_removal: boolean
      contract_allow_type_changes: boolean
      adopt_current_schema?: boolean
    }) =>
      api.updateTableContract(payload.tableId, {
        contract_mode: payload.contract_mode,
        contract_required_columns: payload.contract_required_columns,
        contract_allow_additive_columns: payload.contract_allow_additive_columns,
        contract_allow_column_removal: payload.contract_allow_column_removal,
        contract_allow_type_changes: payload.contract_allow_type_changes,
        adopt_current_schema: payload.adopt_current_schema,
      }),
    onSuccess: (table) => {
      queryClient.invalidateQueries({ queryKey: ['tables'] })
      queryClient.invalidateQueries({ queryKey: ['tables', table.id, 'preview'] })
      queryClient.invalidateQueries({ queryKey: ['tables', table.id, 'lineage'] })
      setStatusMessage(`Updated contract guardrails for ${table.schema_name}.${table.name}.`)
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })
  const updateQualitySuiteMutation = useMutation({
    mutationFn: async (payload: {
      tableId: string
      name: string
      minRows: number
      notNullColumns: string[]
      uniqueColumns: string[]
    }) => {
      const existingAcceptedValueRules =
        tables
          .find((table) => table.id === payload.tableId)
          ?.quality_expectations?.filter((expectation) => expectation.expectation_type === 'accepted_values') ?? []
      return api.updateTableQualitySuite(payload.tableId, {
        name: payload.name,
        expectations: [
          {
            id: 'minimum-row-count',
            expectation_type: 'row_count_between',
            enabled: true,
            severity: 'error',
            min_value: payload.minRows,
            max_value: null,
          },
          ...payload.notNullColumns.map((column) => ({
            id: `not-null-${column}`,
            expectation_type: 'not_null' as const,
            enabled: true,
            severity: 'error' as const,
            column,
          })),
          ...payload.uniqueColumns.map((column) => ({
            id: `unique-${column}`,
            expectation_type: 'unique' as const,
            enabled: true,
            severity: 'warning' as const,
            column,
          })),
          ...existingAcceptedValueRules,
        ],
      })
    },
    onSuccess: (table) => {
      queryClient.invalidateQueries({ queryKey: ['tables'] })
      queryClient.invalidateQueries({ queryKey: ['tables', table.id, 'preview'] })
      setStatusMessage(`Saved quality suite for ${table.schema_name}.${table.name}. Run it to collect fresh evidence.`)
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })
  const runQualitySuiteMutation = useMutation({
    mutationFn: api.runTableQualitySuite,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['tables'] })
      queryClient.invalidateQueries({ queryKey: ['tables', result.table_id, 'preview'] })
      queryClient.invalidateQueries({ queryKey: ['tables', result.table_id, 'quality-runs'] })
      setStatusMessage(`${result.suite_name}: ${result.summary}`)
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })
  const updateQualityScheduleMutation = useMutation({
    mutationFn: (payload: { tableId: string; cron: string | null; enabled: boolean }) =>
      api.updateTableQualitySchedule(payload.tableId, { cron: payload.cron, enabled: payload.enabled }),
    onSuccess: (table) => {
      queryClient.invalidateQueries({ queryKey: ['tables'] })
      queryClient.invalidateQueries({ queryKey: ['quality-scheduler'] })
      setStatusMessage(
        table.quality_schedule_enabled
          ? `Quality checks for ${table.schema_name}.${table.name} are scheduled with ${table.quality_schedule_cron}.`
          : `Disabled scheduled quality checks for ${table.schema_name}.${table.name}.`,
      )
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })
  const runDueQualityMutation = useMutation({
    mutationFn: api.runDueQualitySchedules,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['tables'] })
      queryClient.invalidateQueries({ queryKey: ['quality-scheduler'] })
      queryClient.invalidateQueries({ queryKey: ['tables', selectedTableId, 'quality-runs'] })
      setStatusMessage(`Quality scheduler checked ${result.checked} tables and triggered ${result.triggered.length} runs.`)
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })

  const tables = useMemo(() => tablesQuery.data?.items ?? [], [tablesQuery.data?.items])

  useEffect(() => {
    const requestedTableId = searchParams.get('tableId')
    if (
      requestedTableId &&
      appliedSearchTableIdRef.current !== requestedTableId &&
      tables.some((table) => table.id === requestedTableId)
    ) {
      appliedSearchTableIdRef.current = requestedTableId
      setSelectedTableId(requestedTableId)
      return
    }

    if (!tables.length) {
      setSelectedTableId(null)
      return
    }

    if (!selectedTableId || !tables.some((table) => table.id === selectedTableId)) {
      setSelectedTableId(tables[0].id)
    }
  }, [searchParams, selectedTableId, tables])

  const schemaOptions = useMemo(
    () => ['all', ...Array.from(new Set(tables.map((table) => table.schema_name))).sort()],
    [tables],
  )

  const filteredTables = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return tables.filter((table) => {
      const matchesSchema = schemaFilter === 'all' || table.schema_name === schemaFilter
      const matchesSearch =
        !needle ||
        `${table.schema_name}.${table.name}`.toLowerCase().includes(needle) ||
        (table.description ?? '').toLowerCase().includes(needle)
      return matchesSchema && matchesSearch
    })
  }, [schemaFilter, search, tables])

  useEffect(() => {
    if (!filteredTables.length) {
      return
    }

    if (!selectedTableId || !filteredTables.some((table) => table.id === selectedTableId)) {
      setSelectedTableId(filteredTables[0].id)
    }
  }, [filteredTables, selectedTableId])

  const groupedTables = useMemo(() => {
    return filteredTables.reduce<Record<string, typeof filteredTables>>((accumulator, table) => {
      accumulator[table.schema_name] ??= []
      accumulator[table.schema_name].push(table)
      return accumulator
    }, {})
  }, [filteredTables])

  const selectedTable = tables.find((table) => table.id === selectedTableId) ?? null
  const selectedLineage = lineageQuery.data
  const governedTables = tables.filter((table) => (table.governance_score ?? 0) >= 75).length
  const averageGovernanceScore = tables.length
    ? Math.round(tables.reduce((sum, table) => sum + (table.governance_score ?? 0), 0) / tables.length)
    : 0
  const latestRefresh = tables
    .map((table) => table.last_refreshed_at ?? table.updated_at)
    .filter(Boolean)
    .sort()
    .at(-1)

  useEffect(() => {
    if (!selectedTable) return
    setOwnerDraft(selectedTable.owner ?? '')
    setTagsDraft((selectedTable.tags ?? []).join(', '))
    setLineageDraft(selectedTable.lineage_hint ?? '')
    setContractModeDraft(selectedTable.contract_mode ?? 'warn')
    setContractRequiredColumnsDraft((selectedTable.contract_required_columns ?? []).join(', '))
    setContractAllowAdditiveDraft(selectedTable.contract_allow_additive_columns ?? true)
    setContractAllowRemovalDraft(selectedTable.contract_allow_column_removal ?? false)
    setContractAllowTypeDraft(selectedTable.contract_allow_type_changes ?? false)
    setQualitySuiteNameDraft(selectedTable.quality_suite_name ?? `${selectedTable.schema_name}.${selectedTable.name} baseline`)
    setQualityMinRowsDraft(
      String(
        selectedTable.quality_expectations?.find((expectation) => expectation.expectation_type === 'row_count_between')
          ?.min_value ?? 1,
      ),
    )
    setQualityNotNullDraft(
      (selectedTable.quality_expectations ?? [])
        .filter((expectation) => expectation.expectation_type === 'not_null')
        .map((expectation) => expectation.column)
        .filter(Boolean)
        .join(', '),
    )
    setQualityUniqueDraft(
      (selectedTable.quality_expectations ?? [])
        .filter((expectation) => expectation.expectation_type === 'unique')
        .map((expectation) => expectation.column)
        .filter(Boolean)
        .join(', '),
    )
    setQualityScheduleCronDraft(selectedTable.quality_schedule_cron ?? '')
    setQualityScheduleEnabledDraft(selectedTable.quality_schedule_enabled ?? false)
    setStatusMessage(`Inspecting ${selectedTable.schema_name}.${selectedTable.name}.`)
  }, [selectedTableId, selectedTable])

  const openPipeline = (pipelineId: string) => navigate(`/pipelines?pipelineId=${encodeURIComponent(pipelineId)}`)
  const openNotebook = (notebookId: string) => navigate(`/engines?notebookId=${encodeURIComponent(notebookId)}`)
  const openDataset = (datasetId: string) => navigate(`/bi/datasets?datasetId=${encodeURIComponent(datasetId)}`)
  const openChart = (chartId: string) => navigate(`/bi/charts?chartId=${encodeURIComponent(chartId)}`)
  const openDashboard = (dashboardId: string) => navigate(`/bi/dashboards?dashboardId=${encodeURIComponent(dashboardId)}`)
  const openRouteRef = (routeRef?: string | null) => {
    if (!routeRef) return
    navigate(routeRef)
  }
  const openReports = (dashboardId?: string | null, scheduleId?: string | null) => {
    const params = new URLSearchParams()
    if (dashboardId) params.set('dashboardId', dashboardId)
    if (scheduleId) params.set('scheduleId', scheduleId)
    navigate(params.toString() ? `/bi/reports?${params.toString()}` : '/bi/reports')
  }

  useEffect(() => {
    if (!selectedLineage) return
    const nextFocusOrder: LineageFocus[] = ['upstream', 'pipelines', 'notebooks', 'datasets', 'charts', 'dashboards', 'reports']
    const activeFocuses = new Set<LineageFocus>([
      'upstream',
      ...(selectedLineage.related_pipelines.length ? (['pipelines'] as LineageFocus[]) : []),
      ...(selectedLineage.notebook_artifacts.length ? (['notebooks'] as LineageFocus[]) : []),
      ...(selectedLineage.semantic_datasets.length ? (['datasets'] as LineageFocus[]) : []),
      ...(selectedLineage.charts.length ? (['charts'] as LineageFocus[]) : []),
      ...(selectedLineage.dashboards.length ? (['dashboards'] as LineageFocus[]) : []),
      ...(selectedLineage.report_schedules.length ? (['reports'] as LineageFocus[]) : []),
    ])
    if (!activeFocuses.has(lineageFocus)) {
      setLineageFocus(nextFocusOrder.find((item) => activeFocuses.has(item)) ?? 'upstream')
    }
  }, [lineageFocus, selectedLineage])

  const renderLineageNode = ({
    label,
    meta,
    active,
    focus,
    onClick,
  }: {
    label: string
    meta: string
    active: boolean
    focus?: LineageFocus
    onClick?: () => void
  }) => {
    const content = (
      <>
        <p className="break-words text-sm font-semibold">{label}</p>
        <p className={cn('mt-1 text-[11px] uppercase tracking-[0.18em]', theme === 'dark' ? 'text-white/55' : 'text-slate/55')}>
          {meta}
        </p>
      </>
    )
    const className = cn(
      'min-w-[160px] rounded-2xl border px-4 py-3 text-left transition',
      focus ? lineageFocusTone(theme, lineageFocus === focus) : lineageGraphTone(theme, active),
      onClick ? 'hover:-translate-y-0.5 cursor-pointer' : '',
      !active && !focus ? 'opacity-70' : '',
    )
    if (onClick) {
      return (
        <button type="button" onClick={onClick} className={className}>
          {content}
        </button>
      )
    }
    return <div className={className}>{content}</div>
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Curated Zone"
        title="Lakehouse Catalog"
        description="Browse curated Delta Lake assets by schema, inspect table metadata and schema definitions, and jump straight into SQL exploration from the governed catalog."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Delta Tables" value={String(tables.length)} accent="bg-[#ffe2de]" subtext="Curated assets published into the lakehouse." />
        <StatCard label="Governed Assets" value={String(governedTables)} accent="bg-[#d8f1ff]" subtext="Assets scoring 75 or above on governance readiness." />
        <StatCard label="Average Score" value={`${averageGovernanceScore}/100`} accent="bg-[#e6f7eb]" subtext="Average metadata, freshness, and lineage coverage across the catalog." />
        <StatCard label="Latest Refresh" value={latestRefresh ? formatDate(latestRefresh) : 'N/A'} accent="bg-[#fff4d6]" subtext="Most recently updated curated asset in the catalog." />
      </div>

      <Panel className="rounded-2xl bg-cyan-50 p-4 text-sm text-lagoon">
        <p className="font-semibold">Catalog Status</p>
        <p className="mt-2 leading-6">{statusMessage}</p>
      </Panel>

      {!canEdit ? <Panel className="border-slate-200 bg-slate-50 text-sm text-slate-700">Your current role is read-only. You can browse curated assets and preview data here, but governance edits and metadata refreshes are limited to analysts and admins.</Panel> : null}

      {!tables.length ? (
        <EmptyState
          title="No curated tables yet"
          description="Write a query result to Delta Lake or run a pipeline with a Write Delta node to populate the lakehouse catalog."
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <Panel className="space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Catalog Search</p>
              <Input
                className="mt-3"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search schema, table, or description"
              />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Schema Filter</p>
              <Select className="mt-3" value={schemaFilter} onChange={(event) => setSchemaFilter(event.target.value)}>
                {schemaOptions.map((schema) => (
                  <option key={schema} value={schema}>
                    {schema === 'all' ? 'All schemas' : schema}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-4">
              {Object.entries(groupedTables).map(([schemaName, schemaTables]) => (
                <div key={schemaName}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">{schemaName}</p>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate/65">{schemaTables.length} tables</span>
                  </div>
                  <div className="mt-3 space-y-3">
                    {schemaTables.map((table) => (
                      <button
                        key={table.id}
                        type="button"
                        onClick={() => setSelectedTableId(table.id)}
                        className={`w-full rounded-2xl border p-4 text-left transition ${
                          selectedTableId === table.id
                            ? theme === 'dark'
                              ? 'shadow-[0_0_0_1px_rgba(246,242,74,0.10)]'
                              : 'border-lagoon bg-cyan-50/80 shadow-sm'
                            : theme === 'dark'
                              ? 'border-white/10 bg-white/[0.03]'
                              : 'border-slate-100 bg-slate-50/80'
                        }`}
                        style={
                          selectedTableId === table.id && theme === 'dark'
                            ? {
                                backgroundColor: 'rgba(246, 242, 74, 0.16)',
                                borderColor: 'rgba(246, 242, 74, 0.45)',
                                boxShadow: '0 0 0 1px rgba(246, 242, 74, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.03)',
                              }
                            : undefined
                        }
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="break-words font-semibold text-ink">{table.name}</p>
                            <p className={`mt-1 text-sm ${selectedTableId === table.id && theme === 'dark' ? 'text-white/78' : 'text-slate/70'}`}>
                              {table.description || 'No catalog description yet.'}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                              theme === 'dark'
                                ? selectedTableId === table.id
                                  ? 'bg-black/25 text-[#fff7a8]'
                                  : 'bg-white/10 text-white/72'
                                : 'bg-white text-slate/60'
                            }`}
                          >
                            {table.mode}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className={`rounded-full px-3 py-1 text-xs font-medium ${freshnessTone(table.freshness_status)}`}>
                            {table.freshness_status || 'unknown'}
                          </span>
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${governanceTone(table.governance_status)}`}>
                            Governance {table.governance_score ?? 0}/100
                          </span>
                          {table.owner ? (
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-medium ${
                                theme === 'dark'
                                  ? selectedTableId === table.id
                                    ? 'bg-black/20 text-white'
                                    : 'bg-white/10 text-white/80'
                                  : 'bg-white text-slate-700'
                              }`}
                            >
                              {table.owner}
                            </span>
                          ) : null}
                        </div>
                        <div
                          className={`mt-4 flex flex-wrap gap-2 text-xs ${
                            theme === 'dark'
                              ? selectedTableId === table.id
                                ? 'text-white/72'
                                : 'text-white/55'
                              : 'text-slate/60'
                          }`}
                        >
                          <span>{table.row_count ?? 0} rows</span>
                          <span>•</span>
                          <span>{table.schema_json?.length ?? 0} columns</span>
                          <span>•</span>
                          <span>{formatDate(table.updated_at)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {!filteredTables.length ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate/70">
                  No tables match the current search and schema filter.
                </div>
              ) : null}
            </div>
          </Panel>

          <div className="space-y-5">
            {selectedTable && previewQuery.data ? (
              <>
                <Panel className="space-y-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Selected Table</p>
                      <h2 className="mt-2 break-words font-display text-3xl text-ink">
                        {selectedTable.schema_name}.{selectedTable.name}
                      </h2>
                      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate/70">
                        {selectedTable.description || 'This curated table is available for SQL exploration, downstream pipelines, and BI reporting.'}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${freshnessTone(selectedTable.freshness_status)}`}>
                          {selectedTable.freshness_status || 'unknown'}
                        </span>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${governanceTone(selectedTable.governance_status)}`}>
                          Governance {selectedTable.governance_score ?? 0}/100 · Grade {selectedTable.governance_grade ?? 'N/A'}
                        </span>
                        {selectedTable.tags?.map((tag) => (
                          <span key={tag} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {canEdit ? (
                        <Button tone="ghost" disabled={refreshMutation.isPending} onClick={() => refreshMutation.mutate(selectedTable.id)}>
                          {refreshMutation.isPending ? 'Refreshing...' : 'Refresh Metadata'}
                        </Button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => navigate(`/sql?table=${encodeURIComponent(selectedTable.name)}`)}
                        className="inline-flex items-center justify-center rounded-lg bg-[#ff3621] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#e52c19]"
                      >
                        Open In SQL Workspace
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Rows</p>
                      <p className="mt-2 font-display text-2xl text-ink">{Intl.NumberFormat('en-IN').format(selectedTable.row_count ?? 0)}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Columns</p>
                      <p className="mt-2 font-display text-2xl text-ink">{selectedTable.schema_json?.length ?? 0}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Write Mode</p>
                      <p className="mt-2 font-display text-2xl text-ink">{selectedTable.mode}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Last Refresh</p>
                      <p className="mt-2 text-sm font-semibold text-ink">{formatDate(selectedTable.last_refreshed_at ?? selectedTable.updated_at)}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Owner</p>
                      <p className="mt-2 text-sm font-semibold text-ink">{selectedTable.owner || 'Unassigned'}</p>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
                    <div className="rounded-2xl bg-cyan-50 p-4 text-lagoon">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-lagoon/70">Governance Score</p>
                      <div className="mt-3 flex items-end gap-3">
                        <p className="font-display text-4xl">{selectedTable.governance_score ?? 0}</p>
                        <p className="pb-1 text-sm font-semibold uppercase tracking-[0.18em]">
                          Grade {selectedTable.governance_grade ?? 'N/A'}
                        </p>
                      </div>
                      <p className="mt-3 text-sm leading-6">{selectedTable.governance_summary || 'Governance scoring will appear once metadata is evaluated.'}</p>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Strengths</p>
                        {selectedTable.governance_strengths?.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {selectedTable.governance_strengths.map((item) => (
                              <span key={item} className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                                {item}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-3 text-sm text-slate/70">No standout governance strengths are recorded yet.</p>
                        )}
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Gaps</p>
                        {selectedTable.governance_gaps?.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {selectedTable.governance_gaps.map((item) => (
                              <span key={item} className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
                                {item}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-3 text-sm text-slate/70">No major governance gaps are currently flagged.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate/75">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Storage Location</p>
                      <p className="mt-2 break-all text-ink">{selectedTable.storage_path}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate/75">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Lineage Hint</p>
                      <p className="mt-2 line-clamp-4 text-ink">{selectedTable.lineage_hint || 'Lineage hint unavailable.'}</p>
                    </div>
                  </div>
                </Panel>

                {selectedLineage ? (
                  <Panel className="space-y-5">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Impact Analysis</p>
                        <h3 className="mt-2 font-display text-2xl text-ink">Blast Radius and Change Safety</h3>
                        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate/70">
                          {selectedLineage.impact_analysis.safe_change_summary}
                        </p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${impactSeverityTone(selectedLineage.impact_analysis.severity)}`}>
                        {impactSeverityLabel(selectedLineage.impact_analysis.severity)} impact
                      </span>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <div className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-white/[0.03]' : 'bg-slate-50')}>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Impact Score</p>
                        <p className="mt-2 font-display text-2xl text-ink">{selectedLineage.impact_analysis.score}/100</p>
                        <p className="mt-2 text-sm text-slate/70">Weighted from BI, orchestration, and notebook dependencies.</p>
                      </div>
                      <div className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-white/[0.03]' : 'bg-slate-50')}>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Downstream Assets</p>
                        <p className="mt-2 font-display text-2xl text-ink">{selectedLineage.impact_analysis.total_downstream_assets}</p>
                        <p className="mt-2 text-sm text-slate/70">Datasets, charts, dashboards, and scheduled reports directly linked to this table.</p>
                      </div>
                      <div className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-white/[0.03]' : 'bg-slate-50')}>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Business Exposure</p>
                        <p className="mt-2 text-sm leading-6 text-ink">{selectedLineage.impact_analysis.business_exposure}</p>
                      </div>
                      <div className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-white/[0.03]' : 'bg-slate-50')}>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Operational Exposure</p>
                        <p className="mt-2 text-sm leading-6 text-ink">{selectedLineage.impact_analysis.orchestration_exposure}</p>
                      </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                      <div className={cn('rounded-2xl border p-4', theme === 'dark' ? 'border-white/10 bg-white/[0.03]' : 'border-slate-100 bg-slate-50')}>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Highest-Risk Assets</p>
                            <p className="mt-2 text-sm text-slate/70">These are the first places to inspect before shipping a table change.</p>
                          </div>
                          <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-lagoon">
                            {selectedLineage.impact_analysis.highest_risk_assets.length} linked
                          </span>
                        </div>

                        <div className="mt-4 space-y-3">
                          {selectedLineage.impact_analysis.highest_risk_assets.length ? (
                            selectedLineage.impact_analysis.highest_risk_assets.map((asset) => (
                              <div key={`${asset.kind}-${asset.asset_id ?? asset.label}`} className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-black/20' : 'bg-white')}>
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="break-words font-semibold text-ink">{asset.label}</p>
                                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${impactSeverityTone(asset.severity)}`}>
                                        {impactSeverityLabel(asset.severity)}
                                      </span>
                                    </div>
                                    {asset.secondary_label ? (
                                      <p className="mt-1 text-sm text-slate/70">{asset.secondary_label}</p>
                                    ) : null}
                                    <p className="mt-3 text-sm leading-6 text-slate/70">{asset.reason}</p>
                                  </div>
                                  {asset.route_ref ? (
                                    <Button tone="ghost" onClick={() => openRouteRef(asset.route_ref)}>
                                      Open Asset
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-slate/70">No high-risk downstream assets are currently retained for this table.</p>
                          )}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className={cn('rounded-2xl border p-4', theme === 'dark' ? 'border-white/10 bg-white/[0.03]' : 'border-slate-100 bg-slate-50')}>
                          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Notebook Exposure</p>
                          <p className="mt-2 text-sm leading-6 text-ink">{selectedLineage.impact_analysis.notebook_exposure}</p>
                        </div>
                        <div className={cn('rounded-2xl border p-4', theme === 'dark' ? 'border-white/10 bg-white/[0.03]' : 'border-slate-100 bg-slate-50')}>
                          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Recommended Validation Checklist</p>
                          <div className="mt-4 space-y-3">
                            {selectedLineage.impact_analysis.recommended_checks.map((item) => (
                              <div key={item} className={cn('flex items-start gap-3 rounded-2xl p-3', theme === 'dark' ? 'bg-black/20' : 'bg-white')}>
                                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#0b7285]" />
                                <p className="text-sm leading-6 text-ink">{item}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </Panel>
                ) : null}

                <Panel className="space-y-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Data Contract Guardrails</p>
                      <h3 className="mt-2 font-display text-2xl text-ink">Schema Compatibility Rules</h3>
                      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate/70">
                        Contracts are enforced across every Delta publish path, including SQL Workspace writes, notebook publishes, and pipeline `writeDelta` nodes.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${contractModeTone(selectedTable.contract_mode)}`}>
                        {selectedTable.contract_mode ?? 'warn'} mode
                      </span>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${contractCheckTone(selectedTable.contract_last_check_status)}`}>
                        {selectedTable.contract_last_check_status ?? 'untracked'}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-white/[0.03]' : 'bg-slate-50')}>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Contract Version</p>
                      <p className="mt-2 font-display text-2xl text-ink">{selectedTable.contract_version ?? 1}</p>
                      <p className="mt-2 text-sm text-slate/70">Baseline version retained for compatibility checks.</p>
                    </div>
                    <div className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-white/[0.03]' : 'bg-slate-50')}>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Baseline Columns</p>
                      <p className="mt-2 font-display text-2xl text-ink">{selectedTable.contract_schema_json?.length ?? selectedTable.schema_json?.length ?? 0}</p>
                      <p className="mt-2 text-sm text-slate/70">Columns currently covered by the active contract baseline.</p>
                    </div>
                    <div className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-white/[0.03]' : 'bg-slate-50')}>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Required Columns</p>
                      <p className="mt-2 font-display text-2xl text-ink">{selectedTable.contract_required_columns?.length ?? 0}</p>
                      <p className="mt-2 text-sm text-slate/70">Columns that must survive any future publish.</p>
                    </div>
                    <div className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-white/[0.03]' : 'bg-slate-50')}>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Last Validation</p>
                      <p className="mt-2 text-sm font-semibold text-ink">
                        {selectedTable.contract_last_check_at ? formatDate(selectedTable.contract_last_check_at) : 'Not checked yet'}
                      </p>
                      <p className="mt-2 text-sm text-slate/70">
                        {selectedTable.contract_last_check_summary ?? 'No contract check summary has been recorded yet.'}
                      </p>
                    </div>
                  </div>

                  {selectedTable.contract_last_check_issues?.length ? (
                    <div className={cn('rounded-2xl border p-4', theme === 'dark' ? 'border-amber-400/25 bg-amber-400/8' : 'border-amber-200 bg-amber-50')}>
                      <p className={cn('text-xs font-semibold uppercase tracking-[0.24em]', theme === 'dark' ? 'text-amber-100/80' : 'text-amber-700')}>
                        Last Contract Issues
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedTable.contract_last_check_issues.map((issue) => (
                          <span
                            key={issue}
                            className={cn(
                              'rounded-full px-3 py-1 text-xs font-medium',
                              theme === 'dark' ? 'bg-black/20 text-amber-50' : 'bg-white text-amber-800',
                            )}
                          >
                            {issue}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
                    <fieldset className="grid gap-4" disabled={!canEdit || updateContractMutation.isPending}>
                      <div>
                        <Label>Contract Mode</Label>
                        <Select value={contractModeDraft} onChange={(event) => setContractModeDraft(event.target.value as 'off' | 'warn' | 'strict')}>
                          <option value="off">Off</option>
                          <option value="warn">Warn</option>
                          <option value="strict">Strict</option>
                        </Select>
                      </div>
                      <div className="grid gap-4 md:grid-cols-3">
                        <div>
                          <Label>Allow Additive Columns</Label>
                          <Select value={String(contractAllowAdditiveDraft)} onChange={(event) => setContractAllowAdditiveDraft(event.target.value === 'true')}>
                            <option value="true">Allowed</option>
                            <option value="false">Blocked</option>
                          </Select>
                        </div>
                        <div>
                          <Label>Allow Column Removal</Label>
                          <Select value={String(contractAllowRemovalDraft)} onChange={(event) => setContractAllowRemovalDraft(event.target.value === 'true')}>
                            <option value="false">Blocked</option>
                            <option value="true">Allowed</option>
                          </Select>
                        </div>
                        <div>
                          <Label>Allow Type Changes</Label>
                          <Select value={String(contractAllowTypeDraft)} onChange={(event) => setContractAllowTypeDraft(event.target.value === 'true')}>
                            <option value="false">Blocked</option>
                            <option value="true">Allowed</option>
                          </Select>
                        </div>
                      </div>
                      <div>
                        <Label>Required Columns</Label>
                        <Input
                          value={contractRequiredColumnsDraft}
                          onChange={(event) => setContractRequiredColumnsDraft(event.target.value)}
                          placeholder="order_id, customer_id, order_date"
                        />
                        <p className="mt-2 text-sm text-slate/70">Comma-separated columns that must remain present whenever this table is republished.</p>
                      </div>
                    </fieldset>

                    <div className="space-y-4">
                      <div className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-white/[0.03]' : 'bg-slate-50')}>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Guardrail Behavior</p>
                        <div className="mt-4 space-y-3">
                          <div className={cn('rounded-2xl p-3 text-sm', theme === 'dark' ? 'bg-black/20 text-white/80' : 'bg-white text-slate-700')}>
                            <span className="font-semibold text-ink">Off:</span> publishes proceed without contract validation.
                          </div>
                          <div className={cn('rounded-2xl p-3 text-sm', theme === 'dark' ? 'bg-black/20 text-white/80' : 'bg-white text-slate-700')}>
                            <span className="font-semibold text-ink">Warn:</span> breaking changes are recorded but the publish still lands.
                          </div>
                          <div className={cn('rounded-2xl p-3 text-sm', theme === 'dark' ? 'bg-black/20 text-white/80' : 'bg-white text-slate-700')}>
                            <span className="font-semibold text-ink">Strict:</span> incompatible schema changes block the Delta write before metadata is updated.
                          </div>
                        </div>
                      </div>
                      {canEdit ? (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            disabled={updateContractMutation.isPending}
                            onClick={() =>
                              updateContractMutation.mutate({
                                tableId: selectedTable.id,
                                contract_mode: contractModeDraft,
                                contract_required_columns: contractRequiredColumnsDraft
                                  .split(',')
                                  .map((column) => column.trim())
                                  .filter(Boolean),
                                contract_allow_additive_columns: contractAllowAdditiveDraft,
                                contract_allow_column_removal: contractAllowRemovalDraft,
                                contract_allow_type_changes: contractAllowTypeDraft,
                              })
                            }
                          >
                            {updateContractMutation.isPending ? 'Saving...' : 'Save Guardrails'}
                          </Button>
                          <Button
                            tone="ghost"
                            disabled={updateContractMutation.isPending}
                            onClick={() =>
                              updateContractMutation.mutate({
                                tableId: selectedTable.id,
                                contract_mode: contractModeDraft,
                                contract_required_columns: contractRequiredColumnsDraft
                                  .split(',')
                                  .map((column) => column.trim())
                                  .filter(Boolean),
                                contract_allow_additive_columns: contractAllowAdditiveDraft,
                                contract_allow_column_removal: contractAllowRemovalDraft,
                                contract_allow_type_changes: contractAllowTypeDraft,
                                adopt_current_schema: true,
                              })
                            }
                          >
                            Adopt Current Schema
                          </Button>
                        </div>
                      ) : (
                        <div className={cn('rounded-2xl p-4 text-sm', theme === 'dark' ? 'bg-white/[0.03] text-white/70' : 'bg-slate-50 text-slate-700')}>
                          Your current role can inspect contract state, but only analysts and admins can update table guardrails.
                        </div>
                      )}
                    </div>
                  </div>
                </Panel>

                <Panel className="space-y-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Data Quality Suite</p>
                      <h3 className="mt-2 font-display text-2xl text-ink">Reusable Expectations and Run Evidence</h3>
                      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate/70">
                        Define a baseline row-volume check plus required and unique columns. Manual, scheduled, and pipeline-triggered runs execute against the current Delta snapshot and retain historical evidence.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${qualityTone(selectedTable.quality_last_run_status)}`}>
                        {selectedTable.quality_last_run_status ?? 'untracked'}
                      </span>
                      {canEdit ? (
                        <Button
                          disabled={runQualitySuiteMutation.isPending}
                          onClick={() => runQualitySuiteMutation.mutate(selectedTable.id)}
                        >
                          {runQualitySuiteMutation.isPending ? 'Running...' : 'Run Quality Checks'}
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-white/[0.03]' : 'bg-slate-50')}>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Expectations</p>
                      <p className="mt-2 font-display text-2xl text-ink">{selectedTable.quality_expectations?.length ?? 0}</p>
                      <p className="mt-2 text-sm text-slate/70">Enabled checks in the current suite definition.</p>
                    </div>
                    <div className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-white/[0.03]' : 'bg-slate-50')}>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Passed</p>
                      <p className="mt-2 font-display text-2xl text-ink">
                        {selectedTable.quality_last_run_results?.filter((result) => result.success).length ?? 0}
                      </p>
                      <p className="mt-2 text-sm text-slate/70">Expectations that passed during the latest run.</p>
                    </div>
                    <div className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-white/[0.03]' : 'bg-slate-50')}>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Failed</p>
                      <p className="mt-2 font-display text-2xl text-ink">
                        {selectedTable.quality_last_run_results?.filter((result) => !result.success).length ?? 0}
                      </p>
                      <p className="mt-2 text-sm text-slate/70">Warnings and blocking failures requiring attention.</p>
                    </div>
                    <div className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-white/[0.03]' : 'bg-slate-50')}>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Last Run</p>
                      <p className="mt-2 text-sm font-semibold text-ink">
                        {selectedTable.quality_last_run_at ? formatDate(selectedTable.quality_last_run_at) : 'Not run yet'}
                      </p>
                      <p className="mt-2 text-sm text-slate/70">{selectedTable.quality_last_run_summary ?? 'No run evidence recorded.'}</p>
                    </div>
                  </div>

                  {selectedTable.quality_last_run_results?.length ? (
                    <div className="grid gap-3 lg:grid-cols-2">
                      {selectedTable.quality_last_run_results.map((result) => (
                        <div
                          key={result.id}
                          className={cn(
                            'rounded-2xl border p-4',
                            result.success
                              ? theme === 'dark'
                                ? 'border-emerald-400/20 bg-emerald-400/5'
                                : 'border-emerald-100 bg-emerald-50'
                              : theme === 'dark'
                                ? 'border-rose-400/20 bg-rose-400/5'
                                : 'border-rose-100 bg-rose-50',
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-ink">{result.column || 'Table row count'}</p>
                              <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate/55">
                                {result.expectation_type.replace(/_/g, ' ')}
                              </p>
                            </div>
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${result.success ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                              {result.success ? 'Passed' : result.severity === 'error' ? 'Failed' : 'Warning'}
                            </span>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-slate/75">{result.detail}</p>
                          <p className="mt-2 text-xs text-slate/55">
                            {result.unexpected_count} unexpected · {result.unexpected_percent}% of rows
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="grid gap-5 xl:grid-cols-[1fr_0.8fr]">
                    <fieldset className="grid gap-4" disabled={!canEdit || updateQualitySuiteMutation.isPending}>
                      <div>
                        <Label>Suite Name</Label>
                        <Input value={qualitySuiteNameDraft} onChange={(event) => setQualitySuiteNameDraft(event.target.value)} />
                      </div>
                      <div className="grid gap-4 md:grid-cols-3">
                        <div>
                          <Label>Minimum Rows</Label>
                          <Input
                            type="number"
                            min="0"
                            value={qualityMinRowsDraft}
                            onChange={(event) => setQualityMinRowsDraft(event.target.value)}
                          />
                        </div>
                        <div>
                          <Label>Required / Not-null Columns</Label>
                          <Input
                            value={qualityNotNullDraft}
                            onChange={(event) => setQualityNotNullDraft(event.target.value)}
                            placeholder="order_id, customer_id"
                          />
                        </div>
                        <div>
                          <Label>Unique Columns</Label>
                          <Input
                            value={qualityUniqueDraft}
                            onChange={(event) => setQualityUniqueDraft(event.target.value)}
                            placeholder="order_id"
                          />
                        </div>
                      </div>
                    </fieldset>

                    <div className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-white/[0.03]' : 'bg-slate-50')}>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Execution Semantics</p>
                      <div className="mt-4 space-y-3 text-sm leading-6 text-slate/75">
                        <p><span className="font-semibold text-ink">Minimum rows</span> fails when the current Delta snapshot is unexpectedly empty or undersized.</p>
                        <p><span className="font-semibold text-ink">Required columns</span> fail on null values or missing fields.</p>
                        <p><span className="font-semibold text-ink">Unique columns</span> generate warnings for duplicate non-null values.</p>
                      </div>
                      {canEdit ? (
                        <Button
                          className="mt-5"
                          disabled={updateQualitySuiteMutation.isPending || !qualitySuiteNameDraft.trim()}
                          onClick={() =>
                            updateQualitySuiteMutation.mutate({
                              tableId: selectedTable.id,
                              name: qualitySuiteNameDraft,
                              minRows: Math.max(Number.parseInt(qualityMinRowsDraft || '0', 10), 0),
                              notNullColumns: commaSeparatedValues(qualityNotNullDraft),
                              uniqueColumns: commaSeparatedValues(qualityUniqueDraft),
                            })
                          }
                        >
                          {updateQualitySuiteMutation.isPending ? 'Saving...' : 'Save Quality Suite'}
                        </Button>
                      ) : (
                        <p className="mt-5 text-sm text-slate/70">Analyst or admin access is required to edit and run quality suites.</p>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-5 border-t border-slate-100 pt-5 xl:grid-cols-[0.8fr_1.2fr]">
                    <div className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-white/[0.03]' : 'bg-slate-50')}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Automated Schedule</p>
                          <p className="mt-2 text-sm leading-6 text-slate/75">
                            Run this suite independently from pipelines using the shared backend scheduler.
                          </p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${qualityScheduleEnabledDraft ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
                          {qualityScheduleEnabledDraft ? 'Active' : 'Disabled'}
                        </span>
                      </div>
                      <div className="mt-4 grid gap-4">
                        <div>
                          <Label>Cron Expression</Label>
                          <Input
                            value={qualityScheduleCronDraft}
                            onChange={(event) => setQualityScheduleCronDraft(event.target.value)}
                            placeholder="0 7 * * *"
                            disabled={!canEdit}
                          />
                        </div>
                        <div>
                          <Label>Schedule State</Label>
                          <Select
                            value={String(qualityScheduleEnabledDraft)}
                            onChange={(event) => setQualityScheduleEnabledDraft(event.target.value === 'true')}
                            disabled={!canEdit}
                          >
                            <option value="false">Disabled</option>
                            <option value="true">Enabled</option>
                          </Select>
                        </div>
                        {canEdit ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              disabled={updateQualityScheduleMutation.isPending}
                              onClick={() =>
                                updateQualityScheduleMutation.mutate({
                                  tableId: selectedTable.id,
                                  cron: qualityScheduleCronDraft.trim() || null,
                                  enabled: qualityScheduleEnabledDraft,
                                })
                              }
                            >
                              {updateQualityScheduleMutation.isPending ? 'Saving...' : 'Save Schedule'}
                            </Button>
                            {hasAnyRole('admin') ? (
                              <Button
                                tone="ghost"
                                disabled={runDueQualityMutation.isPending}
                                onClick={() => runDueQualityMutation.mutate()}
                              >
                                {runDueQualityMutation.isPending ? 'Checking...' : 'Run Due Checks'}
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <p className="mt-4 text-xs leading-5 text-slate/55">
                        Scheduler: {qualitySchedulerQuery.data?.running ? 'running' : 'stopped'} · {qualitySchedulerQuery.data?.managed_table_count ?? 0} managed tables · {qualitySchedulerQuery.data?.timezone ?? 'configured timezone'}
                      </p>
                    </div>

                    <div>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Validation History</p>
                          <h4 className="mt-2 font-display text-xl text-ink">Recent Quality Runs</h4>
                        </div>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                          {qualityRunsQuery.data?.items.length ?? 0} runs
                        </span>
                      </div>
                      <div className="mt-4 space-y-3">
                        {qualityRunsQuery.data?.items.length ? (
                          qualityRunsQuery.data.items.slice(0, 8).map((run) => (
                            <div key={run.id} className={cn('rounded-2xl border p-4', theme === 'dark' ? 'border-white/10 bg-white/[0.03]' : 'border-slate-100 bg-slate-50')}>
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <p className="font-semibold text-ink">{run.suite_name}</p>
                                  <p className="mt-1 text-sm text-slate/70">
                                    {run.passed_count}/{run.expectation_count} passed · {run.row_count} rows · {run.duration_ms} ms
                                  </p>
                                </div>
                                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${qualityTone(run.status)}`}>{run.status}</span>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate/55">
                                <span>{run.trigger_type.replace(/_/g, ' ')}</span>
                                <span>·</span>
                                <span>{formatDate(run.started_at)}</span>
                                {run.pipeline_run_id ? <span>· Pipeline run {run.pipeline_run_id}</span> : null}
                              </div>
                              <p className="mt-3 text-sm leading-6 text-slate/75">{run.summary}</p>
                            </div>
                          ))
                        ) : (
                          <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate/70">No persisted quality runs yet.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </Panel>

                <div className="grid gap-5 xl:grid-cols-[0.85fr_minmax(0,1.15fr)]">
                  <Panel>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Schema Definition</p>
                    <div className="mt-4 space-y-3">
                      {selectedTable.schema_json?.map((field, index) => (
                        <div key={`${field.name}-${index}`} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                          <div>
                            <p className="font-semibold text-ink">{field.name}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate/50">Column {index + 1}</p>
                          </div>
                          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate">{field.type}</span>
                        </div>
                      ))}
                    </div>
                  </Panel>

                  <div className="space-y-4">
                    <Panel className="space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Catalog Lineage</p>
                          <h3 className="mt-2 font-display text-2xl text-ink">Upstream and Downstream Relationships</h3>
                        </div>
                        <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-lagoon">
                          {lineageQuery.data?.counts.semantic_datasets ?? 0} datasets · {lineageQuery.data?.counts.dashboards ?? 0} dashboards
                        </span>
                      </div>

                      {selectedLineage ? (
                        <div className="space-y-4">
                          <div
                            className={cn(
                              'rounded-2xl border p-4',
                              theme === 'dark' ? 'border-white/10 bg-white/[0.03]' : 'border-slate-100 bg-slate-50/80',
                            )}
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Mini Lineage Graph</p>
                                <p className="mt-2 text-sm leading-6 text-slate/70">
                                  Click any relationship family below to drill into the exact pipeline, notebook, dataset, chart, dashboard, or report assets attached to this table.
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-lagoon">
                                  {selectedLineage.counts.semantic_datasets} datasets
                                </span>
                                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                                  {selectedLineage.counts.charts} charts
                                </span>
                                <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
                                  {selectedLineage.counts.dashboards} dashboards
                                </span>
                                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                                  {selectedLineage.counts.report_schedules} reports
                                </span>
                              </div>
                            </div>

                            <div className="mt-5 grid gap-3">
                              <div className="flex flex-wrap items-center gap-3">
                                {renderLineageNode({
                                  label:
                                    selectedLineage.upstream.kind === 'pipeline'
                                      ? selectedLineage.upstream.pipeline_name || 'Pipeline publish'
                                      : selectedLineage.upstream.kind === 'notebook'
                                        ? selectedLineage.upstream.notebook_name || 'Notebook publish'
                                        : selectedLineage.upstream.kind === 'sql'
                                          ? 'SQL publish'
                                          : selectedLineage.upstream.label,
                                  meta: selectedLineage.upstream.kind.replace(/_/g, ' '),
                                  active: true,
                                  focus: 'upstream',
                                  onClick: () => setLineageFocus('upstream'),
                                })}
                                <span className={cn('text-lg font-semibold', theme === 'dark' ? 'text-white/35' : 'text-slate/35')}>→</span>
                                {renderLineageNode({
                                  label: selectedTable ? `${selectedTable.schema_name}.${selectedTable.name}` : 'Delta Table',
                                  meta: 'curated delta table',
                                  active: true,
                                })}
                              </div>

                              <div className="flex flex-wrap items-center gap-3">
                                {renderLineageNode({
                                  label: `${selectedLineage.counts.related_pipelines} pipeline target${selectedLineage.counts.related_pipelines === 1 ? '' : 's'}`,
                                  meta: 'orchestration layer',
                                  active: selectedLineage.counts.related_pipelines > 0,
                                  focus: 'pipelines',
                                  onClick: () => setLineageFocus('pipelines'),
                                })}
                                <span className={cn('text-lg font-semibold', theme === 'dark' ? 'text-white/35' : 'text-slate/35')}>→</span>
                                {renderLineageNode({
                                  label: selectedTable ? `${selectedTable.schema_name}.${selectedTable.name}` : 'Delta Table',
                                  meta: 'curated delta table',
                                  active: true,
                                })}
                              </div>

                              <div className="flex flex-wrap items-center gap-3">
                                {renderLineageNode({
                                  label: `${selectedLineage.counts.notebook_artifacts} notebook publish${selectedLineage.counts.notebook_artifacts === 1 ? '' : 'es'}`,
                                  meta: 'engine lab outputs',
                                  active: selectedLineage.counts.notebook_artifacts > 0,
                                  focus: 'notebooks',
                                  onClick: () => setLineageFocus('notebooks'),
                                })}
                                <span className={cn('text-lg font-semibold', theme === 'dark' ? 'text-white/35' : 'text-slate/35')}>→</span>
                                {renderLineageNode({
                                  label: selectedTable ? `${selectedTable.schema_name}.${selectedTable.name}` : 'Delta Table',
                                  meta: 'curated delta table',
                                  active: true,
                                })}
                              </div>

                              <div className="flex flex-wrap items-center gap-3">
                                {renderLineageNode({
                                  label: selectedTable ? `${selectedTable.schema_name}.${selectedTable.name}` : 'Delta Table',
                                  meta: 'curated delta table',
                                  active: true,
                                })}
                                <span className={cn('text-lg font-semibold', theme === 'dark' ? 'text-white/35' : 'text-slate/35')}>→</span>
                                {renderLineageNode({
                                  label: `${selectedLineage.counts.semantic_datasets} semantic dataset${selectedLineage.counts.semantic_datasets === 1 ? '' : 's'}`,
                                  meta: 'dataset explorer',
                                  active: selectedLineage.counts.semantic_datasets > 0,
                                  focus: 'datasets',
                                  onClick: () => setLineageFocus('datasets'),
                                })}
                                <span className={cn('text-lg font-semibold', theme === 'dark' ? 'text-white/35' : 'text-slate/35')}>→</span>
                                {renderLineageNode({
                                  label: `${selectedLineage.counts.charts} saved chart${selectedLineage.counts.charts === 1 ? '' : 's'}`,
                                  meta: 'chart builder',
                                  active: selectedLineage.counts.charts > 0,
                                  focus: 'charts',
                                  onClick: () => setLineageFocus('charts'),
                                })}
                                <span className={cn('text-lg font-semibold', theme === 'dark' ? 'text-white/35' : 'text-slate/35')}>→</span>
                                {renderLineageNode({
                                  label: `${selectedLineage.counts.dashboards} dashboard${selectedLineage.counts.dashboards === 1 ? '' : 's'}`,
                                  meta: 'dashboard viewer',
                                  active: selectedLineage.counts.dashboards > 0,
                                  focus: 'dashboards',
                                  onClick: () => setLineageFocus('dashboards'),
                                })}
                                <span className={cn('text-lg font-semibold', theme === 'dark' ? 'text-white/35' : 'text-slate/35')}>→</span>
                                {renderLineageNode({
                                  label: `${selectedLineage.counts.report_schedules} scheduled report${selectedLineage.counts.report_schedules === 1 ? '' : 's'}`,
                                  meta: 'report scheduler',
                                  active: selectedLineage.counts.report_schedules > 0,
                                  focus: 'reports',
                                  onClick: () => setLineageFocus('reports'),
                                })}
                              </div>
                            </div>
                          </div>

                          <div className="grid gap-4 lg:grid-cols-[0.82fr_1.18fr]">
                            <div className={cn('rounded-2xl border p-4', theme === 'dark' ? 'border-white/10 bg-white/[0.03]' : 'border-slate-100 bg-slate-50')}>
                              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Dependency Focus</p>
                              <div className="mt-4 flex flex-wrap gap-2">
                                {([
                                  ['upstream', 'Upstream'],
                                  ['pipelines', 'Pipelines'],
                                  ['notebooks', 'Notebook Publishes'],
                                  ['datasets', 'Datasets'],
                                  ['charts', 'Charts'],
                                  ['dashboards', 'Dashboards'],
                                  ['reports', 'Reports'],
                                ] as Array<[LineageFocus, string]>).map(([focusKey, label]) => (
                                  <button
                                    key={focusKey}
                                    type="button"
                                    onClick={() => setLineageFocus(focusKey)}
                                    className={cn(
                                      'rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition',
                                      lineageFocusTone(theme, lineageFocus === focusKey),
                                    )}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>

                              <div className="mt-5 rounded-2xl bg-cyan-50 p-4 text-sm text-lagoon">
                                <p className="font-semibold">Drill-down Guidance</p>
                                <p className="mt-2 leading-6">
                                  Use the focus buttons or graph nodes to pivot between producers and consumers. Each drill-down card below jumps into the exact platform surface that owns that dependency.
                                </p>
                              </div>

                              <div className={cn('mt-4 rounded-2xl p-4', theme === 'dark' ? 'bg-black/20' : 'bg-slate-50')}>
                                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Lineage Hint</p>
                                <p className="mt-2 text-sm leading-6 text-ink">{selectedTable.lineage_hint || 'Lineage hint unavailable.'}</p>
                              </div>
                            </div>

                            <div className={cn('rounded-2xl border p-4', theme === 'dark' ? 'border-white/10 bg-white/[0.03]' : 'border-slate-100 bg-slate-50')}>
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Dependency Drill-down</p>
                                  <h4 className="mt-2 font-display text-2xl text-ink">
                                    {lineageFocus === 'upstream'
                                      ? 'Upstream Creator'
                                      : lineageFocus === 'pipelines'
                                        ? 'Pipeline Relationships'
                                        : lineageFocus === 'notebooks'
                                          ? 'Notebook Publish Artifacts'
                                          : lineageFocus === 'datasets'
                                            ? 'Semantic Datasets'
                                            : lineageFocus === 'charts'
                                              ? 'Saved Charts'
                                              : lineageFocus === 'dashboards'
                                                ? 'Dashboards'
                                                : 'Scheduled Reports'}
                                  </h4>
                                </div>
                                <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', theme === 'dark' ? 'bg-black/25 text-white/70' : 'bg-white text-slate/65')}>
                                  {lineageFocus === 'upstream'
                                    ? '1 relationship'
                                    : lineageFocus === 'pipelines'
                                      ? `${selectedLineage.related_pipelines.length} items`
                                      : lineageFocus === 'notebooks'
                                        ? `${selectedLineage.notebook_artifacts.length} items`
                                        : lineageFocus === 'datasets'
                                          ? `${selectedLineage.semantic_datasets.length} items`
                                          : lineageFocus === 'charts'
                                            ? `${selectedLineage.charts.length} items`
                                            : lineageFocus === 'dashboards'
                                              ? `${selectedLineage.dashboards.length} items`
                                              : `${selectedLineage.report_schedules.length} items`}
                                </span>
                              </div>

                              <div className="mt-4 space-y-3">
                                {lineageFocus === 'upstream' ? (
                                  <div className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-black/20' : 'bg-white')}>
                                    <p className="font-semibold text-ink">{selectedLineage.upstream.label}</p>
                                    <p className="mt-2 text-sm leading-6 text-slate/70">
                                      {selectedLineage.upstream.pipeline_name
                                        ? `Pipeline ${selectedLineage.upstream.pipeline_name}${selectedLineage.upstream.node_id ? ` · ${selectedLineage.upstream.node_id}` : ''}`
                                        : selectedLineage.upstream.notebook_name
                                          ? `Notebook ${selectedLineage.upstream.notebook_name}${selectedLineage.upstream.cell_title ? ` · ${selectedLineage.upstream.cell_title}` : ''}`
                                          : selectedLineage.upstream.kind === 'sql'
                                            ? 'This table was published from SQL workspace output.'
                                            : 'No upstream publisher metadata is currently available.'}
                                    </p>
                                    <div className="mt-4 flex flex-wrap gap-2">
                                      {selectedLineage.upstream.pipeline_id ? (
                                        <Button tone="ghost" onClick={() => openPipeline(selectedLineage.upstream.pipeline_id as string)}>
                                          Open Pipeline
                                        </Button>
                                      ) : null}
                                      {selectedLineage.upstream.notebook_id ? (
                                        <Button tone="ghost" onClick={() => openNotebook(selectedLineage.upstream.notebook_id as string)}>
                                          Open Notebook
                                        </Button>
                                      ) : null}
                                      <Button tone="ghost" onClick={() => navigate(`/sql?table=${encodeURIComponent(`${selectedTable.schema_name}.${selectedTable.name}`)}`)}>
                                        Open in SQL Workspace
                                      </Button>
                                    </div>
                                    {selectedLineage.upstream.source_query ? (
                                      <pre className={cn('mt-4 overflow-x-auto rounded-2xl p-3 text-xs leading-6', theme === 'dark' ? 'bg-black/25 text-white/75' : 'bg-slate-50 text-slate-700')}>
                                        {selectedLineage.upstream.source_query}
                                      </pre>
                                    ) : null}
                                  </div>
                                ) : null}

                                {lineageFocus === 'pipelines' ? (
                                  selectedLineage.related_pipelines.length ? (
                                    selectedLineage.related_pipelines.map((pipeline) => (
                                      <div key={pipeline.pipeline_id} className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-black/20' : 'bg-white')}>
                                        <div className="flex items-start justify-between gap-3">
                                          <div>
                                            <p className="font-semibold text-ink">{pipeline.pipeline_name}</p>
                                            <p className="mt-1 text-sm text-slate/70">
                                              {pipeline.node_id || 'writeDelta node'}
                                              {pipeline.schedule_cron ? ` · ${pipeline.schedule_cron}` : ''}
                                            </p>
                                          </div>
                                          <Button tone="ghost" onClick={() => openPipeline(pipeline.pipeline_id)}>
                                            Open
                                          </Button>
                                        </div>
                                        <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate/50">{formatDate(pipeline.updated_at)}</p>
                                      </div>
                                    ))
                                  ) : (
                                    <p className="text-sm text-slate/70">No pipeline definitions currently target this table.</p>
                                  )
                                ) : null}

                                {lineageFocus === 'notebooks' ? (
                                  selectedLineage.notebook_artifacts.length ? (
                                    selectedLineage.notebook_artifacts.map((artifact) => (
                                      <div key={artifact.artifact_id} className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-black/20' : 'bg-white')}>
                                        <div className="flex items-start justify-between gap-3">
                                          <div>
                                            <p className="font-semibold text-ink">{artifact.display_name}</p>
                                            <p className="mt-1 text-sm text-slate/70">
                                              {artifact.cell_title || artifact.cell_id} · {artifact.row_count ?? 0} rows
                                            </p>
                                          </div>
                                          <Button tone="ghost" onClick={() => openNotebook(artifact.notebook_id)}>
                                            Open Notebook
                                          </Button>
                                        </div>
                                        <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate/50">{formatDate(artifact.created_at)}</p>
                                      </div>
                                    ))
                                  ) : (
                                    <p className="text-sm text-slate/70">No notebook publish artifacts are recorded for this table yet.</p>
                                  )
                                ) : null}

                                {lineageFocus === 'datasets' ? (
                                  selectedLineage.semantic_datasets.length ? (
                                    selectedLineage.semantic_datasets.map((dataset) => (
                                      <div key={dataset.dataset_id} className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-black/20' : 'bg-white')}>
                                        <div className="flex items-start justify-between gap-3">
                                          <div>
                                            <p className="font-semibold text-ink">{dataset.dataset_name}</p>
                                            <p className="mt-1 text-sm text-slate/70">{dataset.metrics_count} metrics · {dataset.dimensions_count} dimensions</p>
                                          </div>
                                          <Button tone="ghost" onClick={() => openDataset(dataset.dataset_id)}>
                                            Open Dataset
                                          </Button>
                                        </div>
                                        <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate/50">{formatDate(dataset.updated_at)}</p>
                                      </div>
                                    ))
                                  ) : (
                                    <p className="text-sm text-slate/70">No semantic datasets are registered from this table yet.</p>
                                  )
                                ) : null}

                                {lineageFocus === 'charts' ? (
                                  selectedLineage.charts.length ? (
                                    selectedLineage.charts.map((chart) => (
                                      <div key={chart.chart_id} className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-black/20' : 'bg-white')}>
                                        <div className="flex items-start justify-between gap-3">
                                          <div>
                                            <p className="font-semibold text-ink">{chart.chart_name}</p>
                                            <p className="mt-1 text-sm text-slate/70">{chart.chart_type}</p>
                                          </div>
                                          <div className="flex flex-wrap gap-2">
                                            <Button tone="ghost" onClick={() => openChart(chart.chart_id)}>
                                              Open Chart
                                            </Button>
                                            {chart.dataset_id ? (
                                              <Button tone="ghost" onClick={() => openDataset(chart.dataset_id as string)}>
                                                Dataset
                                              </Button>
                                            ) : null}
                                          </div>
                                        </div>
                                        <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate/50">{formatDate(chart.updated_at)}</p>
                                      </div>
                                    ))
                                  ) : (
                                    <p className="text-sm text-slate/70">No charts currently depend on this table.</p>
                                  )
                                ) : null}

                                {lineageFocus === 'dashboards' ? (
                                  selectedLineage.dashboards.length ? (
                                    selectedLineage.dashboards.map((dashboard) => (
                                      <div key={dashboard.dashboard_id} className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-black/20' : 'bg-white')}>
                                        <div className="flex items-start justify-between gap-3">
                                          <div>
                                            <p className="font-semibold text-ink">{dashboard.dashboard_name}</p>
                                            <p className="mt-1 text-sm text-slate/70">{dashboard.dashboard_description || 'No dashboard description yet.'}</p>
                                          </div>
                                          <Button tone="ghost" onClick={() => openDashboard(dashboard.dashboard_id)}>
                                            Open Dashboard
                                          </Button>
                                        </div>
                                        <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate/50">{formatDate(dashboard.updated_at)}</p>
                                      </div>
                                    ))
                                  ) : (
                                    <p className="text-sm text-slate/70">No dashboards currently consume this table.</p>
                                  )
                                ) : null}

                                {lineageFocus === 'reports' ? (
                                  selectedLineage.report_schedules.length ? (
                                    selectedLineage.report_schedules.map((schedule) => (
                                      <div key={schedule.schedule_id} className={cn('rounded-2xl p-4', theme === 'dark' ? 'bg-black/20' : 'bg-white')}>
                                        <div className="flex items-start justify-between gap-3">
                                          <div>
                                            <p className="font-semibold text-ink">{schedule.schedule_name}</p>
                                            <p className="mt-1 text-sm text-slate/70">
                                              {schedule.frequency} · {schedule.destination}
                                            </p>
                                          </div>
                                          <Button tone="ghost" onClick={() => openReports(schedule.dashboard_id, schedule.schedule_id)}>
                                            Open Schedule
                                          </Button>
                                        </div>
                                        <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate/50">{formatDate(schedule.updated_at)}</p>
                                      </div>
                                    ))
                                  ) : (
                                    <p className="text-sm text-slate/70">No scheduled reports currently depend on this table.</p>
                                  )
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-slate/70">Lineage relationships will appear here after the selected table is resolved.</p>
                      )}
                    </Panel>

                    <Panel className="space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Catalog Governance</p>
                          <h3 className="mt-2 font-display text-2xl text-ink">Scoring Breakdown and Stewardship</h3>
                        </div>
                        {canEdit ? (
                          <Button
                            disabled={updateMetadataMutation.isPending}
                            onClick={() =>
                              updateMetadataMutation.mutate({
                                tableId: selectedTable.id,
                                owner: ownerDraft,
                                tags: tagsDraft
                                  .split(',')
                                  .map((tag) => tag.trim())
                                  .filter(Boolean),
                                lineage_hint: lineageDraft,
                              })
                            }
                          >
                            {updateMetadataMutation.isPending ? 'Saving...' : 'Save Metadata'}
                          </Button>
                        ) : null}
                      </div>
                      <div className="grid gap-3">
                        {(selectedTable.governance_breakdown ?? []).map((item) => (
                          <div key={item.key} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="font-semibold text-ink">{item.label}</p>
                                <p className="mt-1 text-sm text-slate/70">{item.detail}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${item.status === 'strong' ? 'bg-emerald-50 text-emerald-700' : item.status === 'partial' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
                                  {item.status.replace('_', ' ')}
                                </span>
                                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate">
                                  {item.earned_points}/{item.max_points}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <fieldset className="grid gap-4" disabled={!canEdit}>
                        <div>
                          <Label>Owner</Label>
                          <Input value={ownerDraft} onChange={(event) => setOwnerDraft(event.target.value)} placeholder="analytics_engineering" />
                        </div>
                        <div>
                          <Label>Tags</Label>
                          <Input value={tagsDraft} onChange={(event) => setTagsDraft(event.target.value)} placeholder="delta, analytics, finance" />
                        </div>
                        <div>
                          <Label>Lineage Hint</Label>
                          <Textarea rows={4} value={lineageDraft} onChange={(event) => setLineageDraft(event.target.value)} />
                        </div>
                      </fieldset>
                    </Panel>
                    <Panel className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Preview Sample</p>
                        <h3 className="mt-2 font-display text-2xl text-ink">
                          {previewQuery.data.rows.length} preview rows
                        </h3>
                      </div>
                      <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-lagoon">DuckDB + Delta Lake</span>
                    </Panel>
                    <DataTable columns={previewQuery.data.columns} rows={previewQuery.data.rows} />
                  </div>
                </div>
              </>
            ) : (
              <EmptyState
                title="Select a curated table"
                description="Choose a table from the catalog to inspect schema details, storage metadata, and preview rows."
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
