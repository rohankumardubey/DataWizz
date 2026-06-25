import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { DataTable } from '../components/data-table'
import { Button, EmptyState, Input, Label, PageHeader, Panel, Select, Textarea } from '../components/ui'
import { api } from '../lib/api'
import { formatDate } from '../lib/utils'
import type { SemanticDataset, SemanticMetric } from '../types'

function numericFields(dataset?: SemanticDataset) {
  return (dataset?.schema_json ?? []).filter((field) => /(int|float|double|decimal|numeric|real)/i.test(field.type))
}

function dimensionFields(dataset?: SemanticDataset) {
  return (dataset?.schema_json ?? []).filter((field) => !/(int|float|double|decimal|numeric|real)/i.test(field.type))
}

function defaultMetricExpression(dataset?: SemanticDataset) {
  const explicitMetric = dataset?.metrics_json?.[0]
  if (explicitMetric && typeof explicitMetric.expression === 'string') return explicitMetric.expression
  const field = numericFields(dataset)[0]
  return field ? `SUM("${field.name}")` : 'COUNT(*)'
}

function splitDimensions(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function MetricsPage() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const datasetsQuery = useQuery({ queryKey: ['bi', 'datasets'], queryFn: api.listDatasets })
  const metricsQuery = useQuery({ queryKey: ['bi', 'metrics'], queryFn: api.listMetrics })
  const datasets = datasetsQuery.data?.items ?? []
  const metrics = metricsQuery.data?.items ?? []

  const [selectedMetricId, setSelectedMetricId] = useState<string | null>(null)
  const [datasetId, setDatasetId] = useState('')
  const [name, setName] = useState('')
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [expression, setExpression] = useState('')
  const [filterSql, setFilterSql] = useState('')
  const [dimensionsText, setDimensionsText] = useState('')
  const [format, setFormat] = useState('number')
  const [isCertified, setIsCertified] = useState(true)
  const [previewDimension, setPreviewDimension] = useState('')
  const [previewFilter, setPreviewFilter] = useState('')
  const [statusMessage, setStatusMessage] = useState('Define a metric once, then reuse the same business logic across BI surfaces.')

  const selectedDataset = useMemo(() => datasets.find((dataset) => dataset.id === datasetId), [datasetId, datasets])
  const selectedMetric = useMemo(() => metrics.find((metric) => metric.id === selectedMetricId), [metrics, selectedMetricId])
  const availableDimensions = dimensionFields(selectedDataset)

  useEffect(() => {
    if (!datasetId && datasets[0]) {
      setDatasetId(datasets[0].id)
    }
  }, [datasetId, datasets])

  useEffect(() => {
    if (!selectedMetric && selectedDataset && !expression) {
      const baseName = selectedDataset.name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()
      setName(`${baseName}_total`)
      setLabel(`${selectedDataset.name} Total`)
      setExpression(defaultMetricExpression(selectedDataset))
      setDimensionsText(dimensionFields(selectedDataset).slice(0, 1).map((field) => field.name).join(', '))
    }
  }, [expression, selectedDataset, selectedMetric])

  const resetDraft = () => {
    setSelectedMetricId(null)
    const dataset = datasets.find((item) => item.id === datasetId) ?? datasets[0]
    setDatasetId(dataset?.id ?? '')
    const baseName = dataset?.name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'metric'
    setName(`${baseName}_total`)
    setLabel(dataset ? `${dataset.name} Total` : 'Total Metric')
    setDescription('')
    setExpression(defaultMetricExpression(dataset))
    setFilterSql('')
    setDimensionsText(dimensionFields(dataset).slice(0, 1).map((field) => field.name).join(', '))
    setFormat('number')
    setIsCertified(true)
    setStatusMessage('Started a new semantic metric draft.')
  }

  const loadMetric = (metric: SemanticMetric) => {
    setSelectedMetricId(metric.id)
    setDatasetId(metric.dataset_id)
    setName(metric.name)
    setLabel(metric.label)
    setDescription(metric.description ?? '')
    setExpression(metric.expression)
    setFilterSql(metric.filter_sql ?? '')
    setDimensionsText((metric.dimensions_json ?? []).join(', '))
    setFormat(metric.format)
    setIsCertified(metric.is_certified)
    setPreviewDimension((metric.dimensions_json ?? [])[0] ?? '')
    setStatusMessage(`Editing metric ${metric.name}.`)
  }

  const saveMetricMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        label,
        dataset_id: datasetId,
        expression,
        description: description || null,
        filter_sql: filterSql || null,
        dimensions_json: splitDimensions(dimensionsText),
        format,
        is_certified: isCertified,
      }
      return selectedMetricId ? api.updateMetric(selectedMetricId, payload) : api.createMetric(payload)
    },
    onSuccess: (metric) => {
      queryClient.invalidateQueries({ queryKey: ['bi', 'metrics'] })
      setSelectedMetricId(metric.id)
      setStatusMessage(`${selectedMetricId ? 'Updated' : 'Created'} semantic metric ${metric.name}.`)
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })

  const previewMetricMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMetricId) throw new Error('Save the metric before previewing it.')
      return api.previewMetric(selectedMetricId, {
        dimensions: previewDimension ? [previewDimension] : [],
        where_sql: previewFilter || null,
        limit: 100,
      })
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })

  const deleteMetricMutation = useMutation({
    mutationFn: async (metricId: string) => api.deleteMetric(metricId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bi', 'metrics'] })
      resetDraft()
      setStatusMessage('Deleted semantic metric.')
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })

  const preview = previewMetricMutation.data
  const canSave = Boolean(datasetId && name.trim() && label.trim() && expression.trim())

  useEffect(() => {
    const requestedMetricId = searchParams.get('metricId')
    if (!requestedMetricId || selectedMetricId === requestedMetricId) return
    const requestedMetric = metrics.find((metric) => metric.id === requestedMetricId)
    if (requestedMetric) loadMetric(requestedMetric)
  }, [metrics, searchParams, selectedMetricId])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Semantic Metrics"
        title="Metrics Layer"
        description="Create reusable governed business metrics on top of semantic datasets, preview the generated DuckDB SQL, and certify definitions before they reach charts and dashboards."
        actions={<Button onClick={resetDraft} tone="ghost">New Metric</Button>}
      />

      <section className="grid gap-4 lg:grid-cols-4">
        <Panel>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Metrics</p>
          <p className="mt-2 font-display text-3xl text-slate-950">{metrics.length}</p>
          <p className="mt-2 text-sm text-slate-600">Reusable aggregate definitions.</p>
        </Panel>
        <Panel>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Certified</p>
          <p className="mt-2 font-display text-3xl text-slate-950">{metrics.filter((metric) => metric.is_certified).length}</p>
          <p className="mt-2 text-sm text-slate-600">Marked ready for business use.</p>
        </Panel>
        <Panel>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Datasets</p>
          <p className="mt-2 font-display text-3xl text-slate-950">{datasets.length}</p>
          <p className="mt-2 text-sm text-slate-600">Registered semantic sources.</p>
        </Panel>
        <Panel className="bg-cyan-50">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-lagoon/70">Status</p>
          <p className="mt-2 text-sm leading-6 text-lagoon">{statusMessage}</p>
        </Panel>
      </section>

      <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Panel>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-2xl text-slate-950">Saved Metrics</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{metrics.length}</span>
          </div>
          <div className="mt-4 space-y-3">
            {metrics.length ? (
              metrics.map((metric) => (
                <button
                  key={metric.id}
                  type="button"
                  onClick={() => loadMetric(metric)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    selectedMetricId === metric.id ? 'border-lagoon bg-cyan-50 shadow-sm' : 'border-slate-100 bg-slate-50/80 hover:border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-semibold text-slate-950">{metric.label}</p>
                      <p className="mt-1 text-sm text-slate-600">{metric.name}</p>
                    </div>
                    {metric.is_certified ? (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Certified</span>
                    ) : null}
                  </div>
                  <p className="mt-3 line-clamp-2 font-mono text-xs text-slate-500">{metric.expression}</p>
                  <p className="mt-3 text-xs text-slate-500">{metric.dataset_name || 'Unknown dataset'} • {formatDate(metric.updated_at)}</p>
                </button>
              ))
            ) : (
              <EmptyState title="No metrics yet" description="Create the first governed metric from a registered semantic dataset." />
            )}
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel className="space-y-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Metric Definition</p>
                <h2 className="mt-2 font-display text-3xl text-ink">{selectedMetricId ? 'Edit governed metric' : 'Create governed metric'}</h2>
                <p className="mt-2 text-sm leading-6 text-slate/70">Use aggregate SQL such as <code>SUM("revenue")</code>, <code>COUNT(*)</code>, or <code>AVG("order_value")</code>. Filters are optional read-only SQL fragments.</p>
              </div>
              {selectedMetricId ? (
                <Button tone="danger" onClick={() => deleteMetricMutation.mutate(selectedMetricId)} disabled={deleteMetricMutation.isPending}>
                  Delete
                </Button>
              ) : null}
            </div>

            {datasets.length ? (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <Label>Semantic Dataset</Label>
                    <Select value={datasetId} onChange={(event) => {
                      setDatasetId(event.target.value)
                      setExpression('')
                    }}>
                      {datasets.map((dataset) => (
                        <option key={dataset.id} value={dataset.id}>{dataset.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label>Format</Label>
                    <Select value={format} onChange={(event) => setFormat(event.target.value)}>
                      <option value="number">Number</option>
                      <option value="currency">Currency</option>
                      <option value="percent">Percent</option>
                      <option value="integer">Integer</option>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <Label>Metric Name</Label>
                    <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="total_revenue" />
                  </div>
                  <div>
                    <Label>Business Label</Label>
                    <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Total Revenue" />
                  </div>
                </div>

                <div>
                  <Label>Description</Label>
                  <Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="How this metric should be interpreted by analysts." />
                </div>

                <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
                  <div>
                    <Label>Aggregate Expression</Label>
                    <Textarea rows={3} value={expression} onChange={(event) => setExpression(event.target.value)} placeholder='SUM("revenue")' className="font-mono" />
                  </div>
                  <div>
                    <Label>Metric Filter SQL</Label>
                    <Textarea rows={3} value={filterSql} onChange={(event) => setFilterSql(event.target.value)} placeholder="status = 'completed'" className="font-mono" />
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
                  <div>
                    <Label>Default Dimensions</Label>
                    <Input value={dimensionsText} onChange={(event) => setDimensionsText(event.target.value)} placeholder="region, product_category" />
                    <p className="mt-2 text-xs text-slate-500">
                      Available: {availableDimensions.map((field) => field.name).join(', ') || 'No obvious dimension fields detected.'}
                    </p>
                  </div>
                  <label className="mt-6 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                    <input type="checkbox" checked={isCertified} onChange={(event) => setIsCertified(event.target.checked)} />
                    Certified metric
                  </label>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button onClick={() => saveMetricMutation.mutate()} disabled={!canSave || saveMetricMutation.isPending}>
                    {selectedMetricId ? 'Update Metric' : 'Create Metric'}
                  </Button>
                  <Button
                    tone="secondary"
                    onClick={() => previewMetricMutation.mutate()}
                    disabled={!selectedMetricId || previewMetricMutation.isPending}
                  >
                    Preview Metric
                  </Button>
                </div>
              </>
            ) : (
              <EmptyState title="No semantic datasets found" description="Register a semantic dataset first, then return here to define governed metrics." />
            )}
          </Panel>

          {datasets.length ? (
            <Panel className="space-y-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
                <div className="min-w-[220px] flex-1">
                  <Label>Preview Grouping</Label>
                  <Select value={previewDimension} onChange={(event) => setPreviewDimension(event.target.value)}>
                    <option value="">No grouping</option>
                    {availableDimensions.map((field) => (
                      <option key={field.name} value={field.name}>{field.name}</option>
                    ))}
                  </Select>
                </div>
                <div className="flex-[1.5]">
                  <Label>Ad-hoc Preview Filter</Label>
                  <Input value={previewFilter} onChange={(event) => setPreviewFilter(event.target.value)} placeholder="region = 'EMEA'" />
                </div>
                <Button tone="ghost" onClick={() => previewMetricMutation.mutate()} disabled={!selectedMetricId || previewMetricMutation.isPending}>
                  Run Preview
                </Button>
              </div>

              {preview ? (
                <div className="space-y-4">
                  <div className="rounded-2xl bg-slate-950 p-4 text-sm text-white">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">Generated SQL</p>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-6 text-white/85">{preview.sql}</pre>
                  </div>
                  <DataTable columns={preview.columns} rows={preview.rows} />
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-600">
                  Save and preview a metric to inspect the compiled SQL and result rows.
                </div>
              )}
            </Panel>
          ) : (
            <Panel>
              <p className="text-sm text-slate-600">
                Metrics depend on semantic datasets. Go to <Link className="font-semibold text-lagoon" to="/bi/datasets">Dataset Explorer</Link> to register one.
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}
