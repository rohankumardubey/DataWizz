import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChartRenderer } from '../components/chart-renderer'
import { DataTable } from '../components/data-table'
import { MonacoSqlEditor } from '../components/monaco-sql-editor'
import { Button, EmptyState, Input, Label, PageHeader, Panel, Select } from '../components/ui'
import { clearNotebookChartHandoff, readNotebookChartHandoff, type NotebookChartHandoff } from '../lib/chart-handoff'
import { api } from '../lib/api'

type MetricOption = {
  key: string
  label: string
  expression: string
  alias: string
}

type DimensionOption = {
  key: string
  label: string
}

const chartTypes = ['bar', 'line', 'area', 'pie', 'donut', 'timeseries', 'kpi'] as const

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

function inferDimensions(schema: { name: string; type: string }[] = [], datasetDimensions: Record<string, unknown>[] = []): DimensionOption[] {
  if (datasetDimensions.length) {
    return datasetDimensions.map((dimension) => ({
      key: String(dimension.name ?? dimension.label ?? ''),
      label: String(dimension.label ?? dimension.name ?? ''),
    }))
  }

  return schema.map((field) => ({
    key: field.name,
    label: field.name,
  }))
}

function inferMetrics(schema: { name: string; type: string }[] = [], datasetMetrics: Record<string, unknown>[] = []): MetricOption[] {
  const semanticMetrics = datasetMetrics
    .filter((metric) => metric && typeof metric === 'object')
    .map((metric) => {
      const name = String(metric.name ?? 'metric_value')
      return {
        key: `semantic:${name}`,
        label: name,
        expression: String(metric.expression ?? name),
        alias: name.replace(/[^a-z0-9_]+/gi, '_').toLowerCase(),
      }
    })

  const numericMetrics = schema
    .filter((field) => /(int|float|double|decimal|bigint|numeric)/i.test(field.type))
    .map((field) => ({
      key: `sum:${field.name}`,
      label: `SUM(${field.name})`,
      expression: `SUM(${quoteIdentifier(field.name)})`,
      alias: `${field.name}_sum`,
    }))

  return [...semanticMetrics, ...numericMetrics]
}

function inferSnapshotMetrics(columns: string[] = [], rows: Record<string, unknown>[] = []): MetricOption[] {
  return columns
    .filter((column) =>
      rows.some((row) => {
        const value = row[column]
        return typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
      }),
    )
    .map((column) => ({
      key: `snapshot:${column}`,
      label: column,
      expression: column,
      alias: column,
    }))
}

function inferSnapshotDimensions(columns: string[] = []): DimensionOption[] {
  return columns.map((column) => ({ key: column, label: column }))
}

function buildChartSql({
  sourceRef,
  chartType,
  dimension,
  metric,
  rowLimit,
  sortDirection,
  sortBy,
}: {
  sourceRef: string
  chartType: string
  dimension?: string
  metric: MetricOption
  rowLimit: number
  sortDirection: 'asc' | 'desc'
  sortBy: 'value' | 'dimension'
}) {
  const safeSource = quoteIdentifier(sourceRef)
  const safeLimit = Number.isFinite(rowLimit) && rowLimit > 0 ? rowLimit : 10

  if (chartType === 'kpi') {
    return `SELECT ${metric.expression} AS ${quoteIdentifier(metric.alias)}\nFROM ${safeSource}`
  }

  const dimensionExpr = dimension ? quoteIdentifier(dimension) : quoteIdentifier('category')
  const orderBy = chartType === 'timeseries' ? '1 ASC' : sortBy === 'dimension' ? `1 ${sortDirection.toUpperCase()}` : `2 ${sortDirection.toUpperCase()}`

  return `SELECT ${dimensionExpr} AS "dimension", ${metric.expression} AS ${quoteIdentifier(metric.alias)}\nFROM ${safeSource}\nGROUP BY 1\nORDER BY ${orderBy}\nLIMIT ${safeLimit}`
}

export function ChartBuilderPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const datasetsQuery = useQuery({ queryKey: ['bi', 'datasets'], queryFn: api.listDatasets })
  const [name, setName] = useState('Revenue by Region')
  const [chartType, setChartType] = useState<(typeof chartTypes)[number]>('bar')
  const [datasetId, setDatasetId] = useState('')
  const [dimensionKey, setDimensionKey] = useState('')
  const [metricKey, setMetricKey] = useState('')
  const [rowLimit, setRowLimit] = useState('12')
  const [sortBy, setSortBy] = useState<'value' | 'dimension'>('value')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [xAxisLabel, setXAxisLabel] = useState('')
  const [yAxisLabel, setYAxisLabel] = useState('')
  const [color, setColor] = useState('#0b7285')
  const [fillColor, setFillColor] = useState('#d9f0f2')
  const [numberFormat, setNumberFormat] = useState<'number' | 'currency' | 'percent' | 'compact' | 'integer'>('number')
  const [showLegend, setShowLegend] = useState(false)
  const [kpiSubtitle, setKpiSubtitle] = useState('')
  const [kpiThresholdValue, setKpiThresholdValue] = useState('')
  const [kpiThresholdDirection, setKpiThresholdDirection] = useState<'>=' | '<='>('>=')
  const [sql, setSql] = useState('')
  const [askPrompt, setAskPrompt] = useState('show revenue by region')
  const [generatedConfig, setGeneratedConfig] = useState<Record<string, unknown> | null>(null)
  const [generationNotes, setGenerationNotes] = useState<string[]>([])
  const [statusMessage, setStatusMessage] = useState('Choose a semantic dataset, pick a dimension and metric, then generate a chart query.')
  const [notebookHandoff, setNotebookHandoff] = useState<NotebookChartHandoff | null>(null)

  useEffect(() => {
    const handoff = readNotebookChartHandoff()
    if (!handoff) return
    setNotebookHandoff(handoff)
    setName(handoff.chartName)
    setChartType((handoff.chartType as (typeof chartTypes)[number]) || 'bar')
    setDatasetId('')
    setDimensionKey(handoff.categoryKey ?? handoff.columns[0] ?? '')
    setMetricKey(handoff.valueKey ? `snapshot:${handoff.valueKey}` : '')
    setSql('-- Notebook snapshot chart powered by Engine Lab output')
    setStatusMessage(`Loaded notebook output from ${handoff.notebookName}${handoff.cellTitle ? ` · ${handoff.cellTitle}` : ''}. Preview and save it as a BI chart.`)
  }, [])

  const selectedDataset = useMemo(
    () => datasetsQuery.data?.items.find((dataset) => dataset.id === datasetId) ?? null,
    [datasetId, datasetsQuery.data],
  )
  const selectedDatasetSnapshot = useMemo(() => {
    const config = selectedDataset?.source_config_json
    if (selectedDataset?.source_type !== 'notebook_snapshot' || !config) return null
    const snapshotRows = Array.isArray(config.snapshot_rows) ? (config.snapshot_rows as Record<string, unknown>[]) : []
    const snapshotColumns = Array.isArray(config.snapshot_columns) ? (config.snapshot_columns as string[]) : []
    return {
      rows: snapshotRows,
      columns: snapshotColumns,
      notebookName: typeof config.notebook_name === 'string' ? config.notebook_name : selectedDataset.name,
      cellId: typeof config.cell_id === 'string' ? config.cell_id : selectedDataset.id,
      cellTitle: typeof config.cell_title === 'string' ? config.cell_title : null,
    }
  }, [selectedDataset])

  const dimensionOptions = useMemo(
    () =>
      notebookHandoff
        ? inferSnapshotDimensions(notebookHandoff.columns)
        : selectedDatasetSnapshot
          ? inferSnapshotDimensions(selectedDatasetSnapshot.columns)
        : inferDimensions(selectedDataset?.schema_json ?? [], (selectedDataset?.dimensions_json as Record<string, unknown>[] | undefined) ?? []),
    [notebookHandoff, selectedDataset, selectedDatasetSnapshot],
  )

  const metricOptions = useMemo(
    () =>
      notebookHandoff
        ? inferSnapshotMetrics(notebookHandoff.columns, notebookHandoff.rows)
        : selectedDatasetSnapshot
          ? inferSnapshotMetrics(selectedDatasetSnapshot.columns, selectedDatasetSnapshot.rows)
        : inferMetrics(selectedDataset?.schema_json ?? [], (selectedDataset?.metrics_json as Record<string, unknown>[] | undefined) ?? []),
    [notebookHandoff, selectedDataset, selectedDatasetSnapshot],
  )

  const selectedMetric = metricOptions.find((metric) => metric.key === metricKey) ?? null

  useEffect(() => {
    if (notebookHandoff) return
    const firstDataset = datasetsQuery.data?.items[0]
    if (!datasetId && firstDataset) {
      setDatasetId(firstDataset.id)
    }
  }, [datasetId, datasetsQuery.data, notebookHandoff])

  useEffect(() => {
    if (!selectedDataset && !notebookHandoff) return
    if (!dimensionOptions.find((dimension) => dimension.key === dimensionKey)) {
      setDimensionKey(dimensionOptions[0]?.key ?? '')
    }
    if (!metricOptions.find((metric) => metric.key === metricKey)) {
      setMetricKey(metricOptions[0]?.key ?? '')
    }
    if (!notebookHandoff && selectedDataset) {
      setStatusMessage(
        selectedDatasetSnapshot
          ? `Modeling chart preview from notebook-backed semantic dataset ${selectedDataset.name}.`
          : `Modeling chart SQL from semantic dataset ${selectedDataset.name}.`,
      )
    }
  }, [dimensionKey, dimensionOptions, metricKey, metricOptions, notebookHandoff, selectedDataset, selectedDatasetSnapshot])

  useEffect(() => {
    if ((!selectedDataset && !notebookHandoff) || !selectedMetric) return
    const defaultName =
      chartType === 'kpi'
        ? `${selectedMetric.alias.replace(/_/g, ' ')} KPI`
        : `${selectedMetric.alias.replace(/_/g, ' ')} by ${dimensionKey || 'dimension'}`
    setName((current) => (current.trim() ? current : defaultName))
  }, [chartType, dimensionKey, notebookHandoff, selectedDataset, selectedMetric])

  useEffect(() => {
    if (!selectedMetric) return
    if (chartType === 'kpi') {
      setKpiSubtitle((current) => current || selectedMetric.label)
    }
    if (!yAxisLabel && chartType !== 'kpi') {
      setYAxisLabel(selectedMetric.alias)
    }
    if (!xAxisLabel && dimensionKey && chartType !== 'kpi') {
      setXAxisLabel(dimensionKey)
    }
  }, [chartType, dimensionKey, selectedMetric, xAxisLabel, yAxisLabel])

  const previewMutation = useMutation({
    mutationFn: api.previewChart,
    onSuccess: (data) => {
      setStatusMessage(`Preview returned ${data.row_count} rows for ${name}.`)
    },
    onError: (error: Error) => {
      setStatusMessage(error.message)
    },
  })

  const generateChartMutation = useMutation({
    mutationFn: api.generateChart,
    onSuccess: (generated) => {
      const config = generated.config_json ?? {}
      setGeneratedConfig(config)
      setGenerationNotes([...generated.rationale, ...generated.assumptions])
      setName(generated.name)
      setChartType((generated.chart_type as (typeof chartTypes)[number]) || 'bar')
      setDatasetId(generated.dataset_id)
      setSql(generated.query_sql)
      setDimensionKey(String(config.dimensionKey ?? ''))
      setMetricKey(String(config.metricKey ?? ''))
      setRowLimit(String(config.rowLimit ?? rowLimit))
      setSortBy((String(config.sortBy ?? 'value') as 'value' | 'dimension') || 'value')
      setSortDirection((String(config.sortDirection ?? 'desc') as 'asc' | 'desc') || 'desc')
      setXAxisLabel(String(config.xAxisLabel ?? config.dimensionKey ?? ''))
      setYAxisLabel(String(config.yAxisLabel ?? config.metricAlias ?? ''))
      setColor(String(config.color ?? color))
      setFillColor(String(config.fillColor ?? fillColor))
      setNumberFormat((String(config.numberFormat ?? numberFormat) as 'number' | 'currency' | 'percent' | 'compact' | 'integer') || 'number')
      setShowLegend(Boolean(config.showLegend ?? false))
      setKpiSubtitle(String(config.kpiSubtitle ?? ''))
      setStatusMessage(`Ask BI generated ${generated.chart_type} chart SQL with ${Math.round(generated.confidence * 100)}% confidence. Preview it, then save or keep editing.`)
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })

  const saveMutation = useMutation({
    mutationFn: api.createChart,
    onSuccess: (chart) => {
      clearNotebookChartHandoff()
      queryClient.invalidateQueries({ queryKey: ['bi', 'charts'] })
      setName(chart.name)
      setStatusMessage(`Saved chart ${chart.name}.`)
      navigate(`/bi/charts?chartId=${encodeURIComponent(chart.id)}`)
    },
    onError: (error: Error) => {
      setStatusMessage(error.message)
    },
  })

  const generateSql = () => {
    if (notebookHandoff || selectedDatasetSnapshot) {
      setStatusMessage('Notebook-backed charts use the captured cell output directly, so there is no dataset SQL to generate here.')
      return
    }
    if (!selectedDataset || !selectedMetric) {
      setStatusMessage('Select a semantic dataset and metric before generating chart SQL.')
      return
    }

    if (chartType !== 'kpi' && !dimensionKey) {
      setStatusMessage('Choose a dimension for categorical or trend charts.')
      return
    }

    const nextSql = buildChartSql({
      sourceRef: selectedDataset.source_ref,
      chartType,
      dimension: chartType === 'kpi' ? undefined : dimensionKey,
      metric: selectedMetric,
      rowLimit: Number(rowLimit),
      sortDirection,
      sortBy,
    })
    setSql(nextSql)
    setStatusMessage(`Generated SQL for ${selectedDataset.name}. You can preview it or keep editing manually.`)
  }

  const previewRows = notebookHandoff
    ? notebookHandoff.rows
    : selectedDatasetSnapshot
      ? selectedDatasetSnapshot.rows
      : previewMutation.data?.rows ?? []
  const previewColumns = notebookHandoff
    ? notebookHandoff.columns
    : selectedDatasetSnapshot
      ? selectedDatasetSnapshot.columns
      : previewMutation.data?.columns ?? []
  const generatedMetricAlias = typeof generatedConfig?.metricAlias === 'string' ? generatedConfig.metricAlias : undefined
  const previewValueKey = selectedMetric?.alias || generatedMetricAlias || previewColumns[1]

  const saveChart = () => {
    if (!sql.trim() && !notebookHandoff && !selectedDatasetSnapshot) {
      setStatusMessage('Generate or enter chart SQL before saving.')
      return
    }

    saveMutation.mutate({
      name,
      chart_type: chartType,
      dataset_id: datasetId || undefined,
      query_sql: notebookHandoff || selectedDatasetSnapshot ? '-- Notebook snapshot chart from Engine Lab' : sql,
      config_json: {
        ...(generatedConfig ?? {}),
        chartType,
        datasetName: selectedDataset?.name,
        sourceRef: notebookHandoff
          ? `notebook:${notebookHandoff.notebookName}`
          : selectedDatasetSnapshot
            ? `notebook_dataset:${selectedDataset?.name}`
            : selectedDataset?.source_ref,
        dimensionKey: chartType === 'kpi' ? null : dimensionKey,
        metricKey,
        metricAlias: notebookHandoff || selectedDatasetSnapshot ? (selectedMetric?.alias || generatedMetricAlias || previewColumns[1]) : selectedMetric?.alias || generatedMetricAlias,
        sortBy,
        sortDirection,
        rowLimit: Number(rowLimit),
        xAxisLabel: chartType === 'kpi' ? null : xAxisLabel || dimensionKey,
        yAxisLabel: chartType === 'kpi' ? null : yAxisLabel || selectedMetric?.alias,
        color,
        fillColor,
        numberFormat,
        showLegend,
        kpiSubtitle: chartType === 'kpi' ? kpiSubtitle || selectedMetric?.label : null,
        kpiThresholdValue: chartType === 'kpi' && kpiThresholdValue ? Number(kpiThresholdValue) : null,
        kpiThresholdDirection: chartType === 'kpi' ? kpiThresholdDirection : null,
        snapshotSource: notebookHandoff || selectedDatasetSnapshot ? 'notebook' : null,
        snapshotNotebookName: notebookHandoff?.notebookName ?? selectedDatasetSnapshot?.notebookName ?? null,
        snapshotCellId: notebookHandoff?.cellId ?? selectedDatasetSnapshot?.cellId ?? null,
        snapshotCellTitle: notebookHandoff?.cellTitle ?? selectedDatasetSnapshot?.cellTitle ?? null,
        snapshotColumns: notebookHandoff?.columns ?? selectedDatasetSnapshot?.columns ?? null,
        snapshotRows: notebookHandoff?.rows ?? selectedDatasetSnapshot?.rows ?? null,
      },
    })
  }

  const notebookSourceLabel = notebookHandoff
    ? `${notebookHandoff.notebookName}${notebookHandoff.cellTitle ? ` · ${notebookHandoff.cellTitle}` : ''}`
    : selectedDatasetSnapshot
      ? `${selectedDatasetSnapshot.notebookName}${selectedDatasetSnapshot.cellTitle ? ` · ${selectedDatasetSnapshot.cellTitle}` : ''}`
      : null

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Visual Analytics"
        title="Chart Builder"
        description="Build charts from semantic datasets with guided field selection, auto-generated SQL, live chart previews, and saveable metadata for dashboards."
        actions={
          <>
            <Button tone="ghost" onClick={generateSql}>
              Generate SQL
            </Button>
            <Button
              tone="ghost"
              disabled={notebookHandoff ? false : previewMutation.isPending}
              onClick={() => {
                if (notebookHandoff) {
                  setStatusMessage(`Previewing notebook snapshot from ${notebookSourceLabel}.`)
                  return
                }
                previewMutation.mutate({ sql, limit: 200 })
              }}
            >
              {notebookHandoff ? 'Preview Snapshot' : previewMutation.isPending ? 'Previewing...' : 'Preview Chart'}
            </Button>
            <Button disabled={saveMutation.isPending} onClick={saveChart}>
              {saveMutation.isPending ? 'Saving...' : 'Save Chart'}
            </Button>
          </>
        }
      />

      <Panel className="grid gap-4 xl:grid-cols-[1fr_0.9fr_1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Chart Setup</p>
          <p className="mt-2 text-sm leading-6 text-slate/75">
            {notebookHandoff || selectedDatasetSnapshot
              ? 'This draft chart is powered by notebook cell output captured from Engine Lab. You can style it and save it directly into the BI layer.'
              : 'Pick a semantic dataset, choose the dimension and metric you want to visualize, and generate the query that will power the chart.'}
          </p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate/75">
          <p className="font-semibold text-ink">{notebookHandoff || selectedDatasetSnapshot ? 'Notebook Source' : 'Supported Types'}</p>
          <p className="mt-2 leading-6">
            {notebookHandoff || selectedDatasetSnapshot
              ? `Cell result handoff from ${notebookSourceLabel}. This chart will keep a snapshot of the notebook rows so it can still render inside dashboards later.`
              : 'Bar, line, area, pie, donut, timeseries, and KPI visuals are supported in the first BI build.'}
          </p>
        </div>
        <div className="rounded-2xl bg-cyan-50 p-4 text-sm text-lagoon">
          <p className="font-semibold">Builder Status</p>
          <p className="mt-2 leading-6">{statusMessage}</p>
          <p className="mt-3 text-xs uppercase tracking-[0.2em] text-lagoon/70">Preview does not save the chart. Use “Save Chart” to add it to the Saved Charts library.</p>
        </div>
      </Panel>

      <Panel className="space-y-4 border-cyan-100 bg-cyan-50/60">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-lagoon/70">Ask BI</p>
            <h2 className="mt-2 font-display text-2xl text-ink">Generate a chart from plain English</h2>
            <p className="mt-2 text-sm leading-6 text-slate/70">
              Try prompts like “show revenue by region”, “monthly orders over time”, or “total sales KPI”. DataWizz maps your prompt to semantic datasets, metrics, dimensions, SQL, and chart styling.
            </p>
          </div>
          <div className="min-w-0 flex-[1.15]">
            <Label>Question</Label>
            <Input value={askPrompt} onChange={(event) => setAskPrompt(event.target.value)} placeholder="show revenue by region over time" />
          </div>
          <div className="w-full xl:w-52">
            <Label>Optional Dataset</Label>
            <Select value={datasetId} onChange={(event) => setDatasetId(event.target.value)} disabled={Boolean(notebookHandoff)}>
              <option value="">Auto-select</option>
              {datasetsQuery.data?.items.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </Select>
          </div>
          <Button
            disabled={generateChartMutation.isPending || !askPrompt.trim()}
            onClick={() =>
              generateChartMutation.mutate({
                prompt: askPrompt,
                dataset_id: datasetId || null,
                limit: Number(rowLimit) || 12,
              })
            }
          >
            {generateChartMutation.isPending ? 'Thinking...' : 'Generate Chart'}
          </Button>
        </div>
        {generationNotes.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {generationNotes.map((note) => (
              <div key={note} className="rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-slate-700">
                {note}
              </div>
            ))}
          </div>
        ) : null}
      </Panel>

      {datasetsQuery.data?.items?.length || notebookHandoff || selectedDatasetSnapshot ? (
        <div className="grid gap-5 xl:grid-cols-[1.15fr_minmax(0,1fr)]">
          <div className="space-y-5">
            <Panel className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label>Chart Name</Label>
                  <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Revenue by Region" />
                </div>
                <div>
                  <Label>Chart Type</Label>
                  <Select value={chartType} onChange={(event) => setChartType(event.target.value as (typeof chartTypes)[number])}>
                    {chartTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Semantic Dataset</Label>
                  {notebookHandoff ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700">
                      Notebook Snapshot · {notebookSourceLabel}
                    </div>
                  ) : (
                    <Select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>
                      <option value="">Select a dataset</option>
                      {datasetsQuery.data?.items.map((dataset) => (
                        <option key={dataset.id} value={dataset.id}>
                          {dataset.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
                <div>
                  <Label>Metric</Label>
                  <Select value={metricKey} onChange={(event) => setMetricKey(event.target.value)} disabled={!metricOptions.length}>
                    <option value="">Select a metric</option>
                    {metricOptions.map((metric) => (
                      <option key={metric.key} value={metric.key}>
                        {metric.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>{chartType === 'kpi' ? 'Dimension' : 'Group By Dimension'}</Label>
                  <Select value={dimensionKey} onChange={(event) => setDimensionKey(event.target.value)} disabled={chartType === 'kpi' || !dimensionOptions.length}>
                    <option value="">{chartType === 'kpi' ? 'Not needed for KPI' : 'Select a dimension'}</option>
                    {dimensionOptions.map((dimension) => (
                      <option key={dimension.key} value={dimension.key}>
                        {dimension.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label>Sort By</Label>
                    <Select value={sortBy} onChange={(event) => setSortBy(event.target.value as 'value' | 'dimension')} disabled={chartType === 'timeseries' || chartType === 'kpi'}>
                      <option value="value">value</option>
                      <option value="dimension">dimension</option>
                    </Select>
                  </div>
                  <div>
                    <Label>Sort</Label>
                    <Select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as 'asc' | 'desc')} disabled={chartType === 'timeseries' || chartType === 'kpi'}>
                      <option value="desc">desc</option>
                      <option value="asc">asc</option>
                    </Select>
                  </div>
                  <div>
                    <Label>Row Limit</Label>
                    <Input value={rowLimit} onChange={(event) => setRowLimit(event.target.value)} type="number" min={1} />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Chart Customization</p>
                  <p className="mt-2 text-sm leading-6 text-slate/70">Fine-tune how the saved chart looks across the chart library, dashboard canvas, and published dashboard viewer.</p>
                </div>
                <div>
                  <Label>X Axis Label</Label>
                  <Input value={xAxisLabel} onChange={(event) => setXAxisLabel(event.target.value)} placeholder="Region" disabled={chartType === 'kpi' || chartType === 'pie' || chartType === 'donut'} />
                </div>
                <div>
                  <Label>Y Axis Label</Label>
                  <Input value={yAxisLabel} onChange={(event) => setYAxisLabel(event.target.value)} placeholder="Revenue" disabled={chartType === 'kpi' || chartType === 'pie' || chartType === 'donut'} />
                </div>
                <div>
                  <Label>Series Color</Label>
                  <Input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="h-11 p-2" />
                </div>
                <div>
                  <Label>Area Fill</Label>
                  <Input type="color" value={fillColor} onChange={(event) => setFillColor(event.target.value)} className="h-11 p-2" disabled={chartType !== 'area'} />
                </div>
                <div>
                  <Label>Number Format</Label>
                  <Select value={numberFormat} onChange={(event) => setNumberFormat(event.target.value as 'number' | 'currency' | 'percent' | 'compact' | 'integer')}>
                    <option value="number">number</option>
                    <option value="currency">currency</option>
                    <option value="percent">percent</option>
                    <option value="compact">compact</option>
                    <option value="integer">integer</option>
                  </Select>
                </div>
                <div>
                  <Label>Legend</Label>
                  <Select value={showLegend ? 'show' : 'hide'} onChange={(event) => setShowLegend(event.target.value === 'show')} disabled={chartType === 'kpi'}>
                    <option value="hide">hide</option>
                    <option value="show">show</option>
                  </Select>
                </div>
                {chartType === 'kpi' ? (
                  <>
                    <div className="md:col-span-2">
                      <Label>KPI Subtitle</Label>
                      <Input value={kpiSubtitle} onChange={(event) => setKpiSubtitle(event.target.value)} placeholder="Monthly recurring revenue" />
                    </div>
                    <div>
                      <Label>Threshold Direction</Label>
                      <Select value={kpiThresholdDirection} onChange={(event) => setKpiThresholdDirection(event.target.value as '>=' | '<=')}>
                        <option value=">=">{'>='}</option>
                        <option value="<=">{'<='}</option>
                      </Select>
                    </div>
                    <div>
                      <Label>Threshold Value</Label>
                      <Input value={kpiThresholdValue} onChange={(event) => setKpiThresholdValue(event.target.value)} type="number" placeholder="1000" />
                    </div>
                  </>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-3">
                <Button tone="ghost" onClick={generateSql}>
                  Generate Guided SQL
                </Button>
                  <Button
                    tone="ghost"
                    disabled={notebookHandoff || selectedDatasetSnapshot ? false : previewMutation.isPending}
                    onClick={() => {
                      if (notebookHandoff || selectedDatasetSnapshot) {
                        setStatusMessage(`Previewing notebook snapshot from ${notebookSourceLabel}.`)
                        return
                      }
                    previewMutation.mutate({ sql, limit: 200 })
                  }}
                >
                  {notebookHandoff ? 'Preview Snapshot' : previewMutation.isPending ? 'Previewing...' : 'Preview Chart'}
                </Button>
                <Button disabled={saveMutation.isPending} onClick={saveChart}>
                  {saveMutation.isPending ? 'Saving...' : 'Save Chart'}
                </Button>
              </div>
            </Panel>

            <Panel className="space-y-4 p-0">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Chart SQL</p>
                  <h2 className="font-display text-2xl text-ink">Generated Query</h2>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate/70">
                  {selectedDataset?.source_ref || 'No source selected'}
                </span>
              </div>
              <MonacoSqlEditor value={sql} onChange={setSql} height={300} />
              <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-ink">Ready to add this chart to the library?</p>
                  <p className="mt-1 text-sm text-slate/70">
                    {notebookHandoff || selectedDatasetSnapshot
                      ? 'Saving publishes this notebook-backed snapshot into `Saved Charts`, where it can also be embedded into dashboards.'
                      : 'Previewing checks the query only. Saving publishes it to the `Saved Charts` tab.'}
                  </p>
                </div>
                <Button className="min-w-44" disabled={saveMutation.isPending} onClick={saveChart}>
                  {saveMutation.isPending ? 'Saving...' : 'Save Chart To Library'}
                </Button>
              </div>
            </Panel>

            {previewColumns.length ? <DataTable columns={previewColumns} rows={previewRows} /> : null}
          </div>

          <div className="space-y-5">
            <Panel className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">{notebookHandoff ? 'Notebook Context' : 'Dataset Context'}</p>
                  <h2 className="mt-2 font-display text-2xl text-ink">{notebookHandoff || selectedDatasetSnapshot ? notebookSourceLabel : selectedDataset?.name || 'Select a dataset'}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate/70">
                    {notebookHandoff || selectedDatasetSnapshot
                      ? 'This chart is being modeled from captured notebook output rather than a reusable semantic dataset. Save it to preserve the snapshot for dashboards.'
                      : selectedDataset?.description || 'Semantic dataset metadata and reusable metrics will appear here.'}
                  </p>
                </div>
                <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-lagoon">
                  {notebookHandoff || selectedDatasetSnapshot ? 'Notebook Snapshot' : selectedDataset?.source_ref || 'BI'}
                </span>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Columns</p>
                  <p className="mt-2 font-display text-2xl text-ink">{notebookHandoff ? notebookHandoff.columns.length : selectedDatasetSnapshot ? selectedDatasetSnapshot.columns.length : selectedDataset?.schema_json?.length ?? 0}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Dimensions</p>
                  <p className="mt-2 font-display text-2xl text-ink">{dimensionOptions.length}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/50">Metrics</p>
                  <p className="mt-2 font-display text-2xl text-ink">{metricOptions.length}</p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Dimensions</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {dimensionOptions.map((dimension) => (
                      <span key={dimension.key} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                        {dimension.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Metrics</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {metricOptions.map((metric) => (
                      <span key={metric.key} className="rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700">
                        {metric.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Panel>

            <ChartRenderer
              chartType={chartType}
              rows={previewRows}
              title={name}
              categoryKey={chartType === 'kpi' ? undefined : previewColumns[0]}
              valueKey={previewValueKey}
              config={{
                dimensionKey: chartType === 'kpi' ? null : previewColumns[0],
                metricAlias: previewValueKey,
                xAxisLabel,
                yAxisLabel,
                color,
                fillColor,
                numberFormat,
                showLegend,
                kpiSubtitle,
                kpiThresholdValue: kpiThresholdValue ? Number(kpiThresholdValue) : null,
                kpiThresholdDirection,
              }}
            />
          </div>
        </div>
      ) : (
        <EmptyState
          title="No semantic datasets yet"
          description="Create a semantic dataset in Dataset Explorer first, then come back here to build charts from reusable business-friendly fields."
        />
      )}
    </div>
  )
}
