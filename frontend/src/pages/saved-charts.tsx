import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/auth-context'
import { ChartRenderer } from '../components/chart-renderer'
import { DataTable } from '../components/data-table'
import { Button, EmptyState, Input, Label, PageHeader, Panel, Select, Textarea } from '../components/ui'
import { api } from '../lib/api'
import { getChartSnapshot } from '../lib/chart-handoff'
import { formatDate } from '../lib/utils'

export function SavedChartsPage() {
  const { hasAnyRole } = useAuth()
  const canEdit = hasAnyRole('admin', 'analyst')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const chartsQuery = useQuery({ queryKey: ['bi', 'charts'], queryFn: api.listCharts })
  const datasetsQuery = useQuery({ queryKey: ['bi', 'datasets'], queryFn: api.listDatasets })
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusMessage, setStatusMessage] = useState('Select a saved chart to inspect its SQL, dataset mapping, and live preview.')
  const [editName, setEditName] = useState('')
  const [editChartType, setEditChartType] = useState('bar')
  const [editDatasetId, setEditDatasetId] = useState('')
  const [editSql, setEditSql] = useState('')
  const [editDimensionKey, setEditDimensionKey] = useState('')
  const [editMetricAlias, setEditMetricAlias] = useState('')
  const [editRowLimit, setEditRowLimit] = useState('')
  const [editSortBy, setEditSortBy] = useState('value')
  const [editSortDirection, setEditSortDirection] = useState('desc')
  const [editXAxisLabel, setEditXAxisLabel] = useState('')
  const [editYAxisLabel, setEditYAxisLabel] = useState('')
  const [editColor, setEditColor] = useState('#0b7285')
  const [editFillColor, setEditFillColor] = useState('#d9f0f2')
  const [editNumberFormat, setEditNumberFormat] = useState('number')
  const [editLegendMode, setEditLegendMode] = useState('hide')
  const [editKpiSubtitle, setEditKpiSubtitle] = useState('')
  const [editKpiThresholdValue, setEditKpiThresholdValue] = useState('')
  const [editKpiThresholdDirection, setEditKpiThresholdDirection] = useState('>=')

  const charts = chartsQuery.data?.items ?? []
  const datasetNameById = new Map((datasetsQuery.data?.items ?? []).map((dataset) => [dataset.id, dataset.name]))
  const chartTypes = ['all', ...Array.from(new Set(charts.map((chart) => chart.chart_type))).sort()]

  const filteredCharts = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return charts.filter((chart) => {
      const config = chart.config_json as Record<string, unknown>
      const datasetName = (chart.dataset_id && datasetNameById.get(chart.dataset_id)) || String(config.datasetName ?? '')
      const matchesSearch =
        !needle ||
        chart.name.toLowerCase().includes(needle) ||
        chart.chart_type.toLowerCase().includes(needle) ||
        datasetName.toLowerCase().includes(needle)
      const matchesType = typeFilter === 'all' || chart.chart_type === typeFilter
      return matchesSearch && matchesType
    })
  }, [charts, datasetNameById, search, typeFilter])

  useEffect(() => {
    const requestedChartId = searchParams.get('chartId')
    if (requestedChartId && filteredCharts.some((chart) => chart.id === requestedChartId)) {
      setSelectedChartId(requestedChartId)
      return
    }

    if (!filteredCharts.length) {
      setSelectedChartId(null)
      return
    }

    if (!selectedChartId || !filteredCharts.some((chart) => chart.id === selectedChartId)) {
      setSelectedChartId(filteredCharts[0].id)
    }
  }, [filteredCharts, selectedChartId])

  const selectedChart = filteredCharts.find((chart) => chart.id === selectedChartId) ?? charts.find((chart) => chart.id === selectedChartId) ?? null
  const selectedConfig = (selectedChart?.config_json ?? {}) as Record<string, unknown>
  const selectedSnapshot = getChartSnapshot(selectedConfig)
  const selectedDatasetName =
    selectedSnapshot
      ? `Notebook Snapshot${selectedConfig.snapshotNotebookName ? ` · ${String(selectedConfig.snapshotNotebookName)}` : ''}`
      : (selectedChart?.dataset_id && datasetNameById.get(selectedChart.dataset_id)) || String(selectedConfig.datasetName ?? 'Not linked')

  const previewQuery = useQuery({
    queryKey: ['bi', 'charts', 'preview', selectedChartId],
    queryFn: () => api.previewChart({ sql: selectedChart!.query_sql, limit: 200 }),
    enabled: Boolean(selectedChart) && !selectedSnapshot,
  })
  const traceabilityQuery = useQuery({
    queryKey: ['bi', 'charts', selectedChartId, 'traceability'],
    queryFn: () => api.getChartTraceability(selectedChartId!),
    enabled: Boolean(selectedChartId),
  })

  useEffect(() => {
    if (!selectedChart) return
    setStatusMessage(`Inspecting saved chart ${selectedChart.name}.`)
    const config = (selectedChart.config_json ?? {}) as Record<string, unknown>
    setEditName(selectedChart.name)
    setEditChartType(selectedChart.chart_type)
    setEditDatasetId(selectedChart.dataset_id ?? '')
    setEditSql(selectedChart.query_sql)
    setEditDimensionKey(String(config.dimensionKey ?? ''))
    setEditMetricAlias(String(config.metricAlias ?? ''))
    setEditRowLimit(String(config.rowLimit ?? ''))
    setEditSortBy(String(config.sortBy ?? 'value'))
    setEditSortDirection(String(config.sortDirection ?? 'desc'))
    setEditXAxisLabel(String(config.xAxisLabel ?? ''))
    setEditYAxisLabel(String(config.yAxisLabel ?? ''))
    setEditColor(String(config.color ?? '#0b7285'))
    setEditFillColor(String(config.fillColor ?? '#d9f0f2'))
    setEditNumberFormat(String(config.numberFormat ?? 'number'))
    setEditLegendMode(config.showLegend ? 'show' : 'hide')
    setEditKpiSubtitle(String(config.kpiSubtitle ?? ''))
    setEditKpiThresholdValue(String(config.kpiThresholdValue ?? ''))
    setEditKpiThresholdDirection(String(config.kpiThresholdDirection ?? '>='))
  }, [selectedChart])

  const deleteMutation = useMutation({
    mutationFn: api.deleteChart,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bi', 'charts'] })
      setStatusMessage('Chart deleted successfully.')
    },
    onError: (error: Error) => {
      setStatusMessage(error.message)
    },
  })
  const updateMutation = useMutation({
    mutationFn: async (payload: { id: string; body: Record<string, unknown> }) => api.updateChart(payload.id, payload.body),
    onSuccess: (chart) => {
      queryClient.invalidateQueries({ queryKey: ['bi', 'charts'] })
      setSelectedChartId(chart.id)
      setStatusMessage(`Updated chart ${chart.name}.`)
    },
    onError: (error: Error) => {
      setStatusMessage(error.message)
    },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Chart Catalog"
        title="Saved Charts"
        description="Search, inspect, preview, and manage saved chart definitions before wiring them into dashboards or scheduled reports."
      />

      {!canEdit ? (
        <Panel className="border-slate-200 bg-slate-50 text-sm text-slate-700">
          Your current role is read-only. You can inspect saved charts, previews, and downstream dashboard lineage here, but chart edits are limited to analysts and admins.
        </Panel>
      ) : null}

      <Panel className="grid gap-4 xl:grid-cols-[1fr_0.85fr_1fr]">
        <div className="grid gap-4 md:grid-cols-[1fr_180px]">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search charts, types, or datasets" />
          <Select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            {chartTypes.map((type) => (
              <option key={type} value={type}>
                {type === 'all' ? 'All chart types' : type}
              </option>
            ))}
          </Select>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate/75">
          <p className="font-semibold text-ink">Library Workflow</p>
          <p className="mt-2 leading-6">
            {selectedSnapshot
              ? 'Notebook-backed charts preserve a snapshot of the cell output so they can keep rendering inside dashboards even without rerunning the notebook.'
              : 'Saved charts preserve the semantic dataset link, generated SQL, and visualization config that dashboards will reuse.'}
          </p>
        </div>
        <div className="rounded-2xl bg-cyan-50 p-4 text-sm text-lagoon">
          <p className="font-semibold">Library Status</p>
          <p className="mt-2 leading-6">{statusMessage}</p>
        </div>
      </Panel>

      {charts.length ? (
        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <Panel>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl text-ink">Chart Library</h2>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate/65">{filteredCharts.length}</span>
            </div>
            <div className="mt-4 space-y-3">
              {filteredCharts.map((chart) => {
                const config = chart.config_json as Record<string, unknown>
                const datasetName = (chart.dataset_id && datasetNameById.get(chart.dataset_id)) || String(config.datasetName ?? 'Not linked')
                return (
                  <button
                    key={chart.id}
                    type="button"
                    onClick={() => setSelectedChartId(chart.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      selectedChartId === chart.id ? 'border-lagoon bg-cyan-50/70 shadow-sm' : 'border-slate-100 bg-slate-50/80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">{chart.name}</p>
                        <p className="mt-1 text-sm text-slate/70">{datasetName}</p>
                      </div>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/60">
                        {chart.chart_type}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate/60">
                      {config.metricAlias ? <span>Metric {String(config.metricAlias)}</span> : null}
                      {config.dimensionKey ? <span>• {String(config.dimensionKey)}</span> : null}
                    </div>
                    <p className="mt-3 text-xs uppercase tracking-[0.2em] text-slate/50">{formatDate(chart.updated_at)}</p>
                  </button>
                )
              })}
              {!filteredCharts.length ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate/70">
                  No charts match the current search and chart-type filter.
                </div>
              ) : null}
            </div>
          </Panel>

          <div className="space-y-5">
            {selectedChart ? (
              <>
                <Panel className="space-y-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Selected Chart</p>
                      <h2 className="mt-2 font-display text-3xl text-ink">{selectedChart.name}</h2>
                      <p className="mt-3 text-sm leading-6 text-slate/70">
                        {selectedSnapshot
                          ? 'This saved chart is backed by notebook snapshot output and can be embedded into dashboards without depending on a live SQL preview.'
                          : 'This saved chart can be embedded into dashboards and reused across BI workflows without rebuilding the query.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-lagoon">{selectedChart.chart_type}</span>
                      {canEdit ? (
                        <>
                          <Button disabled={updateMutation.isPending} onClick={() => selectedChart && updateMutation.mutate({
                            id: selectedChart.id,
                            body: {
                              name: editName,
                              chart_type: editChartType,
                              dataset_id: editDatasetId || undefined,
                              query_sql: selectedSnapshot ? '-- Notebook snapshot chart from Engine Lab' : editSql,
                              config_json: {
                                ...selectedConfig,
                                dimensionKey: editDimensionKey || null,
                                metricAlias: editMetricAlias || null,
                                rowLimit: editRowLimit ? Number(editRowLimit) : null,
                                sortBy: editSortBy,
                                sortDirection: editSortDirection,
                                xAxisLabel: editXAxisLabel || null,
                                yAxisLabel: editYAxisLabel || null,
                                color: editColor,
                                fillColor: editFillColor,
                                numberFormat: editNumberFormat,
                                showLegend: editLegendMode === 'show',
                                kpiSubtitle: editKpiSubtitle || null,
                                kpiThresholdValue: editKpiThresholdValue ? Number(editKpiThresholdValue) : null,
                                kpiThresholdDirection: editKpiThresholdDirection,
                                datasetName: editDatasetId ? datasetNameById.get(editDatasetId) : undefined,
                              },
                            },
                          })}>
                            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                          </Button>
                          <Button tone="danger" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(selectedChart.id)}>
                            {deleteMutation.isPending ? 'Deleting...' : 'Delete Chart'}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Semantic Dataset</p>
                      <p className="mt-2 text-sm font-semibold text-ink">{selectedDatasetName}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Metric Alias</p>
                      <p className="mt-2 text-sm font-semibold text-ink">{String(selectedConfig.metricAlias ?? 'Derived')}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Updated</p>
                      <p className="mt-2 text-sm font-semibold text-ink">{formatDate(selectedChart.updated_at)}</p>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-2xl bg-cyan-50 p-4 text-lagoon">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-lagoon/70">Dashboard Usage</p>
                      <p className="mt-2 font-display text-2xl">{traceabilityQuery.data?.dashboard_count ?? 0}</p>
                      <p className="mt-2 text-sm">Dashboards currently embedding this chart.</p>
                    </div>
                    <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-700">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700/70">Widget Placements</p>
                      <p className="mt-2 font-display text-2xl">{traceabilityQuery.data?.widget_count ?? 0}</p>
                      <p className="mt-2 text-sm">Widget slots inheriting this chart definition.</p>
                    </div>
                    <div className="rounded-2xl bg-orange-50 p-4 text-orange-700">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-700/70">Scheduled Reports</p>
                      <p className="mt-2 font-display text-2xl">{traceabilityQuery.data?.report_schedule_count ?? 0}</p>
                      <p className="mt-2 text-sm">Report schedules downstream of those dashboards.</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {selectedConfig.dimensionKey ? (
                      <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-medium text-lagoon">
                        Dimension: {String(selectedConfig.dimensionKey)}
                      </span>
                    ) : null}
                    {selectedConfig.rowLimit ? (
                      <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700">
                        Limit: {String(selectedConfig.rowLimit)}
                      </span>
                    ) : null}
                    {selectedConfig.numberFormat ? (
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                        Format: {String(selectedConfig.numberFormat)}
                      </span>
                    ) : null}
                    {selectedSnapshot ? (
                      <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700">
                        Snapshot-backed
                      </span>
                    ) : null}
                    {selectedConfig.sortDirection ? (
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                        Sort: {String(selectedConfig.sortDirection)}
                      </span>
                    ) : null}
                  </div>

                  <fieldset className="grid gap-4 md:grid-cols-2" disabled={!canEdit}>
                    <div>
                      <Label>Chart Name</Label>
                      <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
                    </div>
                    <div>
                      <Label>Chart Type</Label>
                      <Select value={editChartType} onChange={(event) => setEditChartType(event.target.value)}>
                        {['bar', 'line', 'area', 'pie', 'donut', 'timeseries', 'kpi'].map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label>Semantic Dataset</Label>
                      <Select value={editDatasetId} onChange={(event) => setEditDatasetId(event.target.value)}>
                        <option value="">Not linked</option>
                        {datasetsQuery.data?.items?.map((dataset) => (
                          <option key={dataset.id} value={dataset.id}>
                            {dataset.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <Label>Dimension Key</Label>
                        <Input value={editDimensionKey} onChange={(event) => setEditDimensionKey(event.target.value)} />
                      </div>
                      <div>
                        <Label>Metric Alias</Label>
                        <Input value={editMetricAlias} onChange={(event) => setEditMetricAlias(event.target.value)} />
                      </div>
                      <div>
                        <Label>Row Limit</Label>
                        <Input type="number" value={editRowLimit} onChange={(event) => setEditRowLimit(event.target.value)} />
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <Label>Sort Direction</Label>
                      <Select value={editSortDirection} onChange={(event) => setEditSortDirection(event.target.value)}>
                        <option value="desc">desc</option>
                        <option value="asc">asc</option>
                      </Select>
                    </div>
                    <div>
                      <Label>Sort By</Label>
                      <Select value={editSortBy} onChange={(event) => setEditSortBy(event.target.value)}>
                        <option value="value">value</option>
                        <option value="dimension">dimension</option>
                      </Select>
                    </div>
                    <div>
                      <Label>Number Format</Label>
                      <Select value={editNumberFormat} onChange={(event) => setEditNumberFormat(event.target.value)}>
                        <option value="number">number</option>
                        <option value="currency">currency</option>
                        <option value="percent">percent</option>
                        <option value="compact">compact</option>
                        <option value="integer">integer</option>
                      </Select>
                    </div>
                    <div>
                      <Label>X Axis Label</Label>
                      <Input value={editXAxisLabel} onChange={(event) => setEditXAxisLabel(event.target.value)} />
                    </div>
                    <div>
                      <Label>Y Axis Label</Label>
                      <Input value={editYAxisLabel} onChange={(event) => setEditYAxisLabel(event.target.value)} />
                    </div>
                    <div>
                      <Label>Series Color</Label>
                      <Input type="color" value={editColor} onChange={(event) => setEditColor(event.target.value)} className="h-11 p-2" />
                    </div>
                    <div>
                      <Label>Area Fill</Label>
                      <Input type="color" value={editFillColor} onChange={(event) => setEditFillColor(event.target.value)} className="h-11 p-2" disabled={editChartType !== 'area'} />
                    </div>
                    <div>
                      <Label>Legend</Label>
                      <Select value={editLegendMode} onChange={(event) => setEditLegendMode(event.target.value)}>
                        <option value="hide">hide</option>
                        <option value="show">show</option>
                      </Select>
                    </div>
                    {editChartType === 'kpi' ? (
                      <>
                        <div className="md:col-span-2">
                          <Label>KPI Subtitle</Label>
                          <Input value={editKpiSubtitle} onChange={(event) => setEditKpiSubtitle(event.target.value)} />
                        </div>
                        <div>
                          <Label>Threshold Direction</Label>
                          <Select value={editKpiThresholdDirection} onChange={(event) => setEditKpiThresholdDirection(event.target.value)}>
                            <option value=">=">{'>='}</option>
                            <option value="<=">{'<='}</option>
                          </Select>
                        </div>
                        <div>
                          <Label>Threshold Value</Label>
                          <Input type="number" value={editKpiThresholdValue} onChange={(event) => setEditKpiThresholdValue(event.target.value)} />
                        </div>
                      </>
                    ) : null}
                    <div className="md:col-span-2">
                      <Label>Chart SQL</Label>
                      <Textarea rows={10} value={editSql} onChange={(event) => setEditSql(event.target.value)} />
                    </div>
                  </fieldset>
                </Panel>

                <div className="grid gap-5 xl:grid-cols-[0.95fr_minmax(0,1.05fr)]">
                  <div className="space-y-4">
                    <Panel className="space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Traceability</p>
                          <h3 className="mt-2 font-display text-2xl text-ink">Dashboard Lineage</h3>
                        </div>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate/70">
                          {traceabilityQuery.data?.dashboard_count ?? 0} dashboards
                        </span>
                      </div>

                      {traceabilityQuery.data?.dashboards?.length ? (
                        <div className="space-y-3">
                          {traceabilityQuery.data.dashboards.map((usage) => (
                            <div key={usage.widget_id} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <p className="font-semibold text-ink">{usage.dashboard_name}</p>
                                  <p className="mt-2 text-sm text-slate/70">{usage.dashboard_description || 'No dashboard description yet.'}</p>
                                </div>
                                <Button tone="ghost" className="shrink-0" onClick={() => navigate(`/bi/dashboards?dashboardId=${encodeURIComponent(usage.dashboard_id)}`)}>
                                  Open Dashboard
                                </Button>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700">Widget: {usage.widget_title}</span>
                                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700">Type: {usage.widget_type}</span>
                              </div>
                              <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate/50">Updated {formatDate(usage.updated_at)}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate/70">
                          This chart is not embedded into any dashboard yet.
                        </div>
                      )}

                      <div className="border-t border-slate-100 pt-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Downstream Scheduled Reports</p>
                        {traceabilityQuery.data?.report_schedules?.length ? (
                          <div className="mt-3 space-y-3">
                            {traceabilityQuery.data.report_schedules.map((schedule) => (
                              <div key={schedule.schedule_id} className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                <p className="font-semibold">{schedule.schedule_name}</p>
                                <p className="mt-2">
                                  {schedule.dashboard_name || 'Unknown dashboard'} • {schedule.frequency} • {schedule.destination}
                                </p>
                                <p className="mt-2 text-xs uppercase tracking-[0.18em] text-amber-700/70">Updated {formatDate(schedule.updated_at)}</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-3 text-sm text-slate/70">No report schedules currently depend on dashboards that use this chart.</p>
                        )}
                      </div>
                    </Panel>

                    <ChartRenderer
                      chartType={selectedChart.chart_type}
                      rows={selectedSnapshot?.rows ?? previewQuery.data?.rows ?? []}
                      title={selectedChart.name}
                      categoryKey={
                        selectedChart.chart_type === 'kpi'
                          ? undefined
                          : String(selectedConfig.dimensionKey ?? selectedSnapshot?.columns?.[0] ?? previewQuery.data?.columns?.[0] ?? '')
                      }
                      valueKey={String(selectedConfig.metricAlias ?? selectedSnapshot?.columns?.[1] ?? previewQuery.data?.columns?.[1] ?? '')}
                      config={selectedConfig}
                    />
                    <Panel className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Preview Result</p>
                        <h3 className="mt-2 font-display text-2xl text-ink">{selectedSnapshot?.rows.length ?? previewQuery.data?.row_count ?? 0} rows</h3>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate/70">
                        {selectedSnapshot ? 'Notebook snapshot preview' : 'Live query preview'}
                      </span>
                    </Panel>
                  </div>

                  {selectedSnapshot ? (
                    <DataTable columns={selectedSnapshot.columns} rows={selectedSnapshot.rows} />
                  ) : previewQuery.data ? (
                    <DataTable columns={previewQuery.data.columns} rows={previewQuery.data.rows} />
                  ) : (
                    <Panel>
                      <p className="text-sm text-slate/70">Preview rows will appear here after the saved chart query loads.</p>
                    </Panel>
                  )}
                </div>
              </>
            ) : (
              <EmptyState title="Select a saved chart" description="Choose a chart from the library to preview it, inspect its SQL, and manage its lifecycle." />
            )}
          </div>
        </div>
      ) : (
        <EmptyState title="No saved charts yet" description="Create a chart in Chart Builder first, then come back here to manage the saved chart library." />
      )}
    </div>
  )
}
