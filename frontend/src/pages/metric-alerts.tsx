import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, EmptyState, Input, Label, PageHeader, Panel, Select } from '../components/ui'
import { api } from '../lib/api'
import { formatDate } from '../lib/utils'
import type { MetricAlert, SemanticMetric } from '../types'

const comparisonLabels: Record<string, string> = {
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  eq: '=',
  neq: '!=',
}

function statusTone(status: string) {
  if (status === 'triggered') return 'bg-rose-50 text-rose-700'
  if (status === 'ok') return 'bg-emerald-50 text-emerald-700'
  if (status === 'error') return 'bg-amber-50 text-amber-700'
  return 'bg-slate-100 text-slate-600'
}

function deliveryTone(status: string) {
  if (status === 'delivered') return 'bg-emerald-50 text-emerald-700'
  if (status === 'failed') return 'bg-rose-50 text-rose-700'
  if (status === 'skipped') return 'bg-slate-100 text-slate-600'
  return 'bg-amber-50 text-amber-700'
}

function defaultAlertName(metric?: SemanticMetric) {
  const base = metric?.name ?? 'metric'
  return `${base}_threshold_alert`
}

export function MetricAlertsPage() {
  const queryClient = useQueryClient()
  const metricsQuery = useQuery({ queryKey: ['bi', 'metrics'], queryFn: api.listMetrics })
  const alertsQuery = useQuery({ queryKey: ['bi', 'metric-alerts'], queryFn: api.listMetricAlerts })
  const eventsQuery = useQuery({ queryKey: ['bi', 'metric-alert-events'], queryFn: () => api.listMetricAlertEvents({ limit: 75 }) })
  const schedulerStatusQuery = useQuery({
    queryKey: ['bi', 'metric-alert-scheduler-status'],
    queryFn: api.getMetricAlertSchedulerStatus,
    refetchInterval: 15000,
  })

  const metrics = metricsQuery.data?.items ?? []
  const alerts = alertsQuery.data?.items ?? []
  const events = eventsQuery.data?.items ?? []
  const schedulerStatus = schedulerStatusQuery.data

  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null)
  const [metricId, setMetricId] = useState('')
  const [name, setName] = useState('')
  const [comparison, setComparison] = useState<'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq'>('gt')
  const [thresholdValue, setThresholdValue] = useState('0')
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>('warning')
  const [enabled, setEnabled] = useState(true)
  const [notificationChannel, setNotificationChannel] = useState<'local' | 'webhook'>('local')
  const [destination, setDestination] = useState('')
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleCron, setScheduleCron] = useState('*/15 * * * *')
  const [statusMessage, setStatusMessage] = useState('Create threshold rules on governed metrics, then run them locally against DuckDB.')

  const selectedMetric = useMemo(() => metrics.find((metric) => metric.id === metricId), [metricId, metrics])
  const triggeredCount = alerts.filter((alert) => alert.last_status === 'triggered').length
  const healthyCount = alerts.filter((alert) => alert.last_status === 'ok').length
  const enabledCount = alerts.filter((alert) => alert.enabled).length
  const scheduledCount = alerts.filter((alert) => alert.schedule_enabled).length

  useEffect(() => {
    if (!metricId && metrics[0]) {
      setMetricId(metrics[0].id)
      setName(defaultAlertName(metrics[0]))
    }
  }, [metricId, metrics])

  const refreshAlertQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['bi', 'metric-alerts'] })
    queryClient.invalidateQueries({ queryKey: ['bi', 'metric-alert-events'] })
    queryClient.invalidateQueries({ queryKey: ['bi', 'metric-alert-scheduler-status'] })
  }

  const resetDraft = () => {
    const metric = metrics.find((item) => item.id === metricId) ?? metrics[0]
    setSelectedAlertId(null)
    setMetricId(metric?.id ?? '')
    setName(defaultAlertName(metric))
    setComparison('gt')
    setThresholdValue('0')
    setSeverity('warning')
    setEnabled(true)
    setNotificationChannel('local')
    setDestination('')
    setScheduleEnabled(false)
    setScheduleCron('*/15 * * * *')
    setStatusMessage('Started a new metric alert draft.')
  }

  const loadAlert = (alert: MetricAlert) => {
    setSelectedAlertId(alert.id)
    setMetricId(alert.metric_id)
    setName(alert.name)
    setComparison(alert.comparison as typeof comparison)
    setThresholdValue(String(alert.threshold_value))
    setSeverity(alert.severity as typeof severity)
    setEnabled(alert.enabled)
    setNotificationChannel(alert.notification_channel === 'webhook' ? 'webhook' : 'local')
    setDestination(alert.destination ?? '')
    setScheduleEnabled(alert.schedule_enabled)
    setScheduleCron(alert.schedule_cron ?? '*/15 * * * *')
    setStatusMessage(`Editing alert ${alert.name}.`)
  }

  const saveAlertMutation = useMutation({
    mutationFn: async () => {
      const numericThreshold = Number(thresholdValue)
      if (!Number.isFinite(numericThreshold)) throw new Error('Threshold must be a number.')
      const payload = {
        name,
        metric_id: metricId,
        comparison,
        threshold_value: numericThreshold,
        severity,
        enabled,
        notification_channel: notificationChannel,
        destination: destination || null,
        schedule_enabled: scheduleEnabled,
        schedule_cron: scheduleEnabled ? scheduleCron : null,
      }
      return selectedAlertId ? api.updateMetricAlert(selectedAlertId, payload) : api.createMetricAlert(payload)
    },
    onSuccess: (alert) => {
      refreshAlertQueries()
      setSelectedAlertId(alert.id)
      setStatusMessage(`${selectedAlertId ? 'Updated' : 'Created'} metric alert ${alert.name}.`)
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })

  const deleteAlertMutation = useMutation({
    mutationFn: async (alertId: string) => api.deleteMetricAlert(alertId),
    onSuccess: () => {
      refreshAlertQueries()
      resetDraft()
      setStatusMessage('Deleted metric alert.')
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })

  const evaluateAlertMutation = useMutation({
    mutationFn: async (alertId: string) => api.evaluateMetricAlert(alertId),
    onSuccess: (result) => {
      refreshAlertQueries()
      setStatusMessage(result.event.message)
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })

  const evaluateAllMutation = useMutation({
    mutationFn: api.evaluateAllMetricAlerts,
    onSuccess: (result) => {
      refreshAlertQueries()
      setStatusMessage(`Checked ${result.checked} enabled alerts: ${result.triggered} triggered, ${result.errored} errored.`)
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })

  const runDueSchedulesMutation = useMutation({
    mutationFn: api.runDueMetricAlertSchedules,
    onSuccess: (result) => {
      refreshAlertQueries()
      setStatusMessage(`Scheduler checked ${result.checked} alerts and evaluated ${result.evaluated.length} due rules.`)
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })

  const canSave = Boolean(metricId && name.trim() && thresholdValue.trim())

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="BI Operations"
        title="Metric Alerts"
        description="Monitor semantic metrics with local threshold rules, keep an auditable event trail, and turn dashboards into operational BI surfaces."
        actions={
          <>
            <Button tone="ghost" onClick={resetDraft}>New Alert</Button>
            <Button tone="secondary" onClick={() => runDueSchedulesMutation.mutate()} disabled={runDueSchedulesMutation.isPending}>
              Run Due Schedules
            </Button>
            <Button onClick={() => evaluateAllMutation.mutate()} disabled={!enabledCount || evaluateAllMutation.isPending}>
              Run Enabled Alerts
            </Button>
          </>
        }
      />

      <section className="grid gap-4 lg:grid-cols-5">
        <Panel>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Alerts</p>
          <p className="mt-2 font-display text-3xl text-slate-950">{alerts.length}</p>
          <p className="mt-2 text-sm text-slate-600">{enabledCount} enabled rules.</p>
        </Panel>
        <Panel>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Scheduled</p>
          <p className="mt-2 font-display text-3xl text-slate-950">{scheduledCount}</p>
          <p className="mt-2 text-sm text-slate-600">Managed by the local scheduler.</p>
        </Panel>
        <Panel>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Triggered</p>
          <p className="mt-2 font-display text-3xl text-slate-950">{triggeredCount}</p>
          <p className="mt-2 text-sm text-slate-600">Currently above or below threshold.</p>
        </Panel>
        <Panel>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Healthy</p>
          <p className="mt-2 font-display text-3xl text-slate-950">{healthyCount}</p>
          <p className="mt-2 text-sm text-slate-600">Last run returned OK.</p>
        </Panel>
        <Panel className="bg-cyan-50">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-lagoon/70">Status</p>
          <p className="mt-2 text-sm leading-6 text-lagoon">{statusMessage}</p>
        </Panel>
      </section>

      <Panel>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Scheduler</p>
            <h2 className="mt-2 font-display text-2xl text-ink">Metric alert scheduler</h2>
            <p className="mt-2 text-sm leading-6 text-slate/70">
              Uses the same local scheduler loop as pipelines and quality checks. Due alerts are evaluated in the background when the backend is running.
            </p>
          </div>
          <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-3 lg:min-w-[520px]">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Runtime</p>
              <p className="mt-2 font-semibold text-slate-950">
                {schedulerStatus?.enabled ? (schedulerStatus.running ? 'Running' : 'Enabled') : 'Disabled'}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Managed</p>
              <p className="mt-2 font-semibold text-slate-950">{schedulerStatus?.managed_alert_count ?? scheduledCount} alerts</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Last Tick</p>
              <p className="mt-2 font-semibold text-slate-950">
                {schedulerStatus?.last_tick_at ? formatDate(schedulerStatus.last_tick_at) : 'Not yet'}
              </p>
            </div>
          </div>
        </div>
        {schedulerStatus?.last_summary.next_due?.length ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {schedulerStatus.last_summary.next_due.slice(0, 4).map((item) => (
              <div key={item.alert_id} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4 text-sm">
                <p className="font-semibold text-slate-950">{item.alert_name}</p>
                <p className="mt-1 font-mono text-xs text-slate-500">{item.cron}</p>
                <p className="mt-2 text-slate-600">Next due: {formatDate(item.next_run_at)}</p>
              </div>
            ))}
          </div>
        ) : null}
        {schedulerStatus?.last_error ? (
          <p className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">{schedulerStatus.last_error}</p>
        ) : null}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Panel>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-2xl text-slate-950">Alert Rules</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{alerts.length}</span>
          </div>
          <div className="mt-4 space-y-3">
            {alerts.length ? (
              alerts.map((alert) => (
                <button
                  key={alert.id}
                  type="button"
                  onClick={() => loadAlert(alert)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    selectedAlertId === alert.id ? 'border-lagoon bg-cyan-50 shadow-sm' : 'border-slate-100 bg-slate-50/80 hover:border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-semibold text-slate-950">{alert.name}</p>
                      <p className="mt-1 text-sm text-slate-600">{alert.metric_label ?? alert.metric_name ?? 'Unknown metric'}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${statusTone(alert.last_status)}`}>
                      {alert.last_status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="mt-3 font-mono text-xs text-slate-500">
                    {comparisonLabels[alert.comparison] ?? alert.comparison} {alert.threshold_value}
                  </p>
                  <p className="mt-3 text-xs text-slate-500">
                    {alert.enabled ? 'Enabled' : 'Paused'} • {alert.schedule_enabled ? `Scheduled ${alert.schedule_cron}` : 'Manual'} • {alert.last_evaluated_at ? formatDate(alert.last_evaluated_at) : 'Never evaluated'}
                  </p>
                </button>
              ))
            ) : (
              <EmptyState title="No alerts yet" description="Create a metric alert from a governed metric, then run the first threshold check." />
            )}
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel className="space-y-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Alert Definition</p>
                <h2 className="mt-2 font-display text-3xl text-ink">{selectedAlertId ? 'Edit metric alert' : 'Create metric alert'}</h2>
                <p className="mt-2 text-sm leading-6 text-slate/70">
                  Each rule evaluates one semantic metric without dimensions and stores the local result as alert history.
                </p>
              </div>
              {selectedAlertId ? (
                <div className="flex flex-wrap gap-3">
                  <Button
                    tone="secondary"
                    onClick={() => evaluateAlertMutation.mutate(selectedAlertId)}
                    disabled={evaluateAlertMutation.isPending}
                  >
                    Run Now
                  </Button>
                  <Button tone="danger" onClick={() => deleteAlertMutation.mutate(selectedAlertId)} disabled={deleteAlertMutation.isPending}>
                    Delete
                  </Button>
                </div>
              ) : null}
            </div>

            {metrics.length ? (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <Label>Semantic Metric</Label>
                    <Select
                      value={metricId}
                      onChange={(event) => {
                        const nextMetric = metrics.find((metric) => metric.id === event.target.value)
                        setMetricId(event.target.value)
                        if (!selectedAlertId) setName(defaultAlertName(nextMetric))
                      }}
                    >
                      {metrics.map((metric) => (
                        <option key={metric.id} value={metric.id}>
                          {metric.label} {metric.is_certified ? '✓' : ''}
                        </option>
                      ))}
                    </Select>
                    <p className="mt-2 text-xs text-slate-500">
                      {selectedMetric?.dataset_name ?? 'Unknown dataset'} • {selectedMetric?.source_ref ?? 'No source'}
                    </p>
                  </div>
                  <div>
                    <Label>Alert Name</Label>
                    <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="total_revenue_threshold_alert" />
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[180px_1fr_180px]">
                  <div>
                    <Label>Comparison</Label>
                    <Select value={comparison} onChange={(event) => setComparison(event.target.value as typeof comparison)}>
                      <option value="gt">Greater than</option>
                      <option value="gte">Greater than or equal</option>
                      <option value="lt">Less than</option>
                      <option value="lte">Less than or equal</option>
                      <option value="eq">Equal</option>
                      <option value="neq">Not equal</option>
                    </Select>
                  </div>
                  <div>
                    <Label>Threshold Value</Label>
                    <Input value={thresholdValue} onChange={(event) => setThresholdValue(event.target.value)} placeholder="100000" inputMode="decimal" />
                  </div>
                  <div>
                    <Label>Severity</Label>
                    <Select value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)}>
                      <option value="info">Info</option>
                      <option value="warning">Warning</option>
                      <option value="critical">Critical</option>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
                  <label className="mt-6 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                    <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
                    Enabled for sweeps
                  </label>
                  <div>
                    <Label>Delivery Channel</Label>
                    <Select value={notificationChannel} onChange={(event) => setNotificationChannel(event.target.value as typeof notificationChannel)}>
                      <option value="local">Local event log</option>
                      <option value="webhook">Webhook POST</option>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label>{notificationChannel === 'webhook' ? 'Webhook URL' : 'Local Destination Note'}</Label>
                  <Input
                    value={destination}
                    onChange={(event) => setDestination(event.target.value)}
                    placeholder={notificationChannel === 'webhook' ? 'http://localhost:9009/datawizz-alerts' : 'analytics-ops, local demo, stakeholder alias'}
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    {notificationChannel === 'webhook'
                      ? 'Triggered alerts post a JSON payload to this URL. Delivery failures are recorded on the alert event.'
                      : 'Local delivery records the alert event inside DataWizz without calling an external service.'}
                  </p>
                </div>

                {notificationChannel === 'webhook' ? (
                  <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
                    Webhook delivery only runs when the alert is triggered. Non-triggered checks are marked as skipped.
                  </div>
                ) : null}

                <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
                  <label className="mt-6 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                    <input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} />
                    Scheduled monitoring
                  </label>
                  <div>
                    <Label>Cron Schedule</Label>
                    <Input value={scheduleCron} onChange={(event) => setScheduleCron(event.target.value)} placeholder="*/15 * * * *" className="font-mono" />
                    <p className="mt-2 text-xs text-slate-500">
                      Uses {schedulerStatus?.timezone ?? 'the backend scheduler timezone'}; examples: <code>*/15 * * * *</code>, <code>0 9 * * 1-5</code>.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button onClick={() => saveAlertMutation.mutate()} disabled={!canSave || saveAlertMutation.isPending}>
                    {selectedAlertId ? 'Update Alert' : 'Create Alert'}
                  </Button>
                  {selectedAlertId ? (
                    <Button tone="ghost" onClick={() => evaluateAlertMutation.mutate(selectedAlertId)} disabled={evaluateAlertMutation.isPending}>
                      Evaluate Saved Rule
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-600">
                Metric alerts need at least one semantic metric. Go to{' '}
                <Link className="font-semibold text-lagoon" to="/bi/metrics">Metrics Layer</Link> to create one first.
              </div>
            )}
          </Panel>

          <Panel>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Recent Events</p>
                <h2 className="mt-2 font-display text-2xl text-ink">Alert history</h2>
              </div>
              <Button tone="ghost" onClick={() => eventsQuery.refetch()}>Refresh</Button>
            </div>

            <div className="mt-4 space-y-3">
              {events.length ? (
                events.map((event) => (
                  <div key={event.id} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${statusTone(event.status)}`}>
                            {event.status}
                          </span>
                          <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-lagoon">
                            {event.triggered ? 'Action needed' : 'Observed'}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                            {event.trigger_type}
                          </span>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${deliveryTone(event.delivery_status)}`}>
                            {event.delivery_status}
                          </span>
                        </div>
                        <p className="mt-3 font-semibold text-slate-950">{event.alert_name ?? 'Metric alert'}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{event.message}</p>
                        {event.delivery_error ? (
                          <p className="mt-2 text-xs text-rose-700">Delivery: {event.delivery_error}</p>
                        ) : null}
                      </div>
                      <div className="text-left text-xs text-slate-500 lg:text-right">
                        <p>{formatDate(event.evaluated_at)}</p>
                        <p className="mt-1 font-mono">
                          value {event.observed_value ?? 'n/a'} / threshold {event.threshold_value}
                        </p>
                        {event.delivery_channel ? (
                          <p className="mt-1">
                            {event.delivery_channel}
                            {event.delivery_response_code ? ` • HTTP ${event.delivery_response_code}` : ''}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-600">
                  No alert events yet. Run an alert to populate local history.
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
