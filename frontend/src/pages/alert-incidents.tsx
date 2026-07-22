import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, EmptyState, Input, Label, PageHeader, Panel, Select, Textarea } from '../components/ui'
import { api } from '../lib/api'
import { formatDate } from '../lib/utils'
import type { MetricAlertIncident } from '../types'

type IncidentStatusFilter = 'active' | 'open' | 'acknowledged' | 'resolved' | 'all'
type IncidentSeverityFilter = 'all' | 'info' | 'warning' | 'critical'

function statusTone(status: string) {
  if (status === 'open') return 'bg-rose-50 text-rose-700'
  if (status === 'acknowledged') return 'bg-amber-50 text-amber-700'
  if (status === 'resolved') return 'bg-emerald-50 text-emerald-700'
  return 'bg-slate-100 text-slate-600'
}

function severityTone(severity: string) {
  if (severity === 'critical') return 'bg-rose-100 text-rose-800'
  if (severity === 'warning') return 'bg-amber-100 text-amber-800'
  return 'bg-cyan-50 text-lagoon'
}

function isActive(incident: MetricAlertIncident) {
  return incident.status === 'open' || incident.status === 'acknowledged'
}

export function AlertIncidentsPage() {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<IncidentStatusFilter>('active')
  const [severityFilter, setSeverityFilter] = useState<IncidentSeverityFilter>('all')
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
  const [assigneeEmail, setAssigneeEmail] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [resolutionNote, setResolutionNote] = useState('')
  const [statusMessage, setStatusMessage] = useState('Triggered metric alerts automatically open incidents here for investigation and ownership.')

  const incidentsQuery = useQuery({
    queryKey: ['bi', 'metric-alert-incidents'],
    queryFn: () => api.listMetricAlertIncidents({ status: 'all', limit: 200 }),
    refetchInterval: 15000,
  })
  const incidents = useMemo(() => incidentsQuery.data?.items ?? [], [incidentsQuery.data?.items])
  const filteredIncidents = useMemo(
    () => incidents.filter((incident) => {
      const statusMatches = statusFilter === 'all'
        || (statusFilter === 'active' ? isActive(incident) : incident.status === statusFilter)
      const severityMatches = severityFilter === 'all' || incident.severity === severityFilter
      return statusMatches && severityMatches
    }),
    [incidents, severityFilter, statusFilter],
  )
  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId) ?? null

  useEffect(() => {
    if (!filteredIncidents.length) {
      setSelectedIncidentId(null)
      return
    }
    if (!selectedIncidentId || !filteredIncidents.some((incident) => incident.id === selectedIncidentId)) {
      setSelectedIncidentId(filteredIncidents[0].id)
    }
  }, [filteredIncidents, selectedIncidentId])

  useEffect(() => {
    setAssigneeEmail(selectedIncident?.assignee_email ?? '')
    setNoteBody('')
    setResolutionNote('')
  }, [selectedIncident?.id, selectedIncident?.assignee_email])

  const refreshIncidents = async () => {
    await queryClient.invalidateQueries({ queryKey: ['bi', 'metric-alert-incidents'] })
    await queryClient.invalidateQueries({ queryKey: ['bi', 'metric-alerts'] })
  }

  const acknowledgeMutation = useMutation({
    mutationFn: (incident: MetricAlertIncident) => api.acknowledgeMetricAlertIncident(incident.id, {
      assignee_email: assigneeEmail.trim() || null,
    }),
    onSuccess: async (incident) => {
      await refreshIncidents()
      setStatusMessage(`Acknowledged ${incident.title}.`)
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })

  const assignMutation = useMutation({
    mutationFn: (incident: MetricAlertIncident) => api.assignMetricAlertIncident(incident.id, {
      assignee_email: assigneeEmail.trim() || null,
    }),
    onSuccess: async (incident) => {
      await refreshIncidents()
      setStatusMessage(incident.assignee_email ? `Assigned to ${incident.assignee_email}.` : 'Incident is now unassigned.')
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })

  const resolveMutation = useMutation({
    mutationFn: (incident: MetricAlertIncident) => api.resolveMetricAlertIncident(incident.id, {
      resolution_note: resolutionNote.trim(),
    }),
    onSuccess: async (incident) => {
      await refreshIncidents()
      setResolutionNote('')
      setStatusMessage(`Resolved ${incident.title}. A later trigger will open a new incident.`)
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })

  const reopenMutation = useMutation({
    mutationFn: (incident: MetricAlertIncident) => api.reopenMetricAlertIncident(incident.id),
    onSuccess: async (incident) => {
      await refreshIncidents()
      setStatusFilter('active')
      setSelectedIncidentId(incident.id)
      setStatusMessage(`Reopened ${incident.title}.`)
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })

  const addNoteMutation = useMutation({
    mutationFn: (incident: MetricAlertIncident) => api.addMetricAlertIncidentNote(incident.id, { body: noteBody.trim() }),
    onSuccess: async () => {
      await refreshIncidents()
      setNoteBody('')
      setStatusMessage('Investigation note added.')
    },
    onError: (error: Error) => setStatusMessage(error.message),
  })

  const openCount = incidents.filter((incident) => incident.status === 'open').length
  const acknowledgedCount = incidents.filter((incident) => incident.status === 'acknowledged').length
  const criticalActiveCount = incidents.filter((incident) => incident.severity === 'critical' && isActive(incident)).length
  const resolvedCount = incidents.filter((incident) => incident.status === 'resolved').length

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="BI Operations"
        title="Alert Incidents"
        description="Move from threshold signals to owned operational work: acknowledge alerts, assign responders, retain investigation notes, and record resolution evidence."
        actions={
          <>
            <Link className="ui-button inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50" to="/bi/alerts">
              Alert Rules
            </Link>
            <Button onClick={() => incidentsQuery.refetch()} disabled={incidentsQuery.isFetching}>Refresh</Button>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Panel>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Open</p>
          <p className="mt-2 font-display text-3xl text-slate-950">{openCount}</p>
          <p className="mt-2 text-sm text-slate-600">Waiting for acknowledgement.</p>
        </Panel>
        <Panel>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Acknowledged</p>
          <p className="mt-2 font-display text-3xl text-slate-950">{acknowledgedCount}</p>
          <p className="mt-2 text-sm text-slate-600">Owned and under investigation.</p>
        </Panel>
        <Panel>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Critical Active</p>
          <p className="mt-2 font-display text-3xl text-rose-700">{criticalActiveCount}</p>
          <p className="mt-2 text-sm text-slate-600">Highest-priority active work.</p>
        </Panel>
        <Panel>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Resolved</p>
          <p className="mt-2 font-display text-3xl text-emerald-700">{resolvedCount}</p>
          <p className="mt-2 text-sm text-slate-600">Closed with resolution evidence.</p>
        </Panel>
        <Panel className="bg-cyan-50">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-lagoon/70">Operations Status</p>
          <p className="mt-2 text-sm leading-6 text-lagoon">{statusMessage}</p>
        </Panel>
      </section>

      <Panel className="grid gap-4 lg:grid-cols-2">
        <div>
          <Label>Lifecycle</Label>
          <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as IncidentStatusFilter)}>
            <option value="active">Active incidents</option>
            <option value="open">Open only</option>
            <option value="acknowledged">Acknowledged only</option>
            <option value="resolved">Resolved only</option>
            <option value="all">All incidents</option>
          </Select>
        </div>
        <div>
          <Label>Severity</Label>
          <Select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as IncidentSeverityFilter)}>
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </Select>
        </div>
      </Panel>

      {filteredIncidents.length ? (
        <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
          <Panel>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-2xl text-slate-950">Incident Queue</h2>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{filteredIncidents.length}</span>
            </div>
            <div className="mt-4 space-y-3">
              {filteredIncidents.map((incident) => (
                <button
                  key={incident.id}
                  type="button"
                  onClick={() => setSelectedIncidentId(incident.id)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    selectedIncidentId === incident.id
                      ? 'border-lagoon bg-cyan-50 shadow-sm'
                      : 'border-slate-100 bg-slate-50/80 hover:border-slate-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${severityTone(incident.severity)}`}>
                      {incident.severity}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${statusTone(incident.status)}`}>
                      {incident.status}
                    </span>
                  </div>
                  <p className="mt-3 break-words font-semibold text-slate-950">{incident.title}</p>
                  <p className="mt-1 text-sm text-slate-600">{incident.metric_label ?? incident.alert_name ?? 'Metric alert'}</p>
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
                    <span>{incident.assignee_email ?? 'Unassigned'}</span>
                    <span>{incident.trigger_count} trigger{incident.trigger_count === 1 ? '' : 's'}</span>
                  </div>
                </button>
              ))}
            </div>
          </Panel>

          {selectedIncident ? (
            <div className="space-y-5">
              <Panel>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${severityTone(selectedIncident.severity)}`}>
                        {selectedIncident.severity}
                      </span>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${statusTone(selectedIncident.status)}`}>
                        {selectedIncident.status}
                      </span>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${selectedIncident.alert_last_status === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        source {selectedIncident.alert_last_status ?? 'unknown'}
                      </span>
                    </div>
                    <h2 className="mt-4 font-display text-3xl text-ink">{selectedIncident.title}</h2>
                    <p className="mt-2 text-sm text-slate-600">{selectedIncident.metric_label ?? selectedIncident.alert_name}</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {selectedIncident.status === 'open' ? (
                      <Button
                        tone="secondary"
                        onClick={() => acknowledgeMutation.mutate(selectedIncident)}
                        disabled={acknowledgeMutation.isPending}
                      >
                        Acknowledge
                      </Button>
                    ) : null}
                    {selectedIncident.status === 'resolved' ? (
                      <Button onClick={() => reopenMutation.mutate(selectedIncident)} disabled={reopenMutation.isPending}>Reopen</Button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Opened</p>
                    <p className="mt-2 text-sm font-semibold text-slate-950">{formatDate(selectedIncident.opened_at)}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Latest Trigger</p>
                    <p className="mt-2 text-sm font-semibold text-slate-950">{formatDate(selectedIncident.last_triggered_at)}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Trigger Count</p>
                    <p className="mt-2 text-sm font-semibold text-slate-950">{selectedIncident.trigger_count}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Latest Value</p>
                    <p className="mt-2 text-sm font-semibold text-slate-950">{selectedIncident.latest_observed_value ?? 'N/A'}</p>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Latest Signal</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{selectedIncident.latest_message ?? 'No alert message retained.'}</p>
                </div>
              </Panel>

              <div className="grid gap-5 lg:grid-cols-2">
                <Panel>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Ownership</p>
                  <h3 className="mt-2 font-display text-2xl text-ink">Responder assignment</h3>
                  <div className="mt-4">
                    <Label>Assignee Email</Label>
                    <Input
                      value={assigneeEmail}
                      onChange={(event) => setAssigneeEmail(event.target.value)}
                      placeholder="analytics-oncall@company.com"
                      disabled={selectedIncident.status === 'resolved'}
                    />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button
                      tone="ghost"
                      onClick={() => assignMutation.mutate(selectedIncident)}
                      disabled={selectedIncident.status === 'resolved' || assignMutation.isPending}
                    >
                      Save Assignment
                    </Button>
                    {selectedIncident.status === 'open' ? (
                      <Button
                        tone="secondary"
                        onClick={() => acknowledgeMutation.mutate(selectedIncident)}
                        disabled={acknowledgeMutation.isPending}
                      >
                        Assign & Acknowledge
                      </Button>
                    ) : null}
                  </div>
                  {selectedIncident.acknowledged_at ? (
                    <p className="mt-4 text-xs leading-5 text-slate-500">
                      Acknowledged by {selectedIncident.acknowledged_by_email} on {formatDate(selectedIncident.acknowledged_at)}.
                    </p>
                  ) : null}
                </Panel>

                <Panel>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Resolution</p>
                  <h3 className="mt-2 font-display text-2xl text-ink">Close the loop</h3>
                  {selectedIncident.status === 'resolved' ? (
                    <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">
                      <p className="font-semibold">Resolved by {selectedIncident.resolved_by_email}</p>
                      <p className="mt-2 leading-6">{selectedIncident.resolution_note}</p>
                      {selectedIncident.resolved_at ? <p className="mt-2 text-xs">{formatDate(selectedIncident.resolved_at)}</p> : null}
                    </div>
                  ) : (
                    <>
                      <div className="mt-4">
                        <Label>Resolution Evidence</Label>
                        <Textarea
                          rows={4}
                          value={resolutionNote}
                          onChange={(event) => setResolutionNote(event.target.value)}
                          placeholder="What happened, what changed, and why is this safe to close?"
                        />
                      </div>
                      <Button
                        className="mt-4"
                        onClick={() => resolveMutation.mutate(selectedIncident)}
                        disabled={!resolutionNote.trim() || resolveMutation.isPending}
                      >
                        Resolve Incident
                      </Button>
                    </>
                  )}
                </Panel>
              </div>

              <Panel>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Investigation Timeline</p>
                  <h3 className="mt-2 font-display text-2xl text-ink">Notes and evidence</h3>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
                  <div>
                    <Label>Add Note</Label>
                    <Textarea
                      rows={3}
                      value={noteBody}
                      onChange={(event) => setNoteBody(event.target.value)}
                      placeholder="Record observations, query results, decisions, or handoff context."
                    />
                  </div>
                  <Button
                    onClick={() => addNoteMutation.mutate(selectedIncident)}
                    disabled={!noteBody.trim() || addNoteMutation.isPending}
                  >
                    Add Note
                  </Button>
                </div>

                <div className="mt-5 space-y-3">
                  {selectedIncident.notes.length ? selectedIncident.notes.map((note) => (
                    <div key={note.id} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm font-semibold text-slate-950">{note.author_email}</p>
                        <p className="text-xs text-slate-500">{formatDate(note.created_at)}</p>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{note.body}</p>
                    </div>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-600">
                      No investigation notes yet. Add the first observation or ownership handoff above.
                    </div>
                  )}
                </div>
              </Panel>
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState
          title={incidents.length ? 'No incidents match these filters' : 'No alert incidents yet'}
          description={incidents.length
            ? 'Adjust lifecycle or severity filters to find another incident.'
            : 'Run a metric alert whose threshold triggers. DataWizz will automatically open the first incident.'}
        />
      )}
    </div>
  )
}
