import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { EmptyState, Input, PageHeader, Panel, Select } from '../components/ui'
import { api } from '../lib/api'
import { formatDate } from '../lib/utils'

function eventTone(eventType: string) {
  if (eventType === 'COMPLETE') return 'bg-emerald-50 text-emerald-700'
  if (eventType === 'FAIL') return 'bg-rose-50 text-rose-700'
  if (eventType === 'START') return 'bg-cyan-50 text-lagoon'
  return 'bg-slate-100 text-slate-700'
}

function deliveryTone(status: string) {
  if (status === 'delivered') return 'bg-emerald-50 text-emerald-700'
  if (status === 'failed') return 'bg-rose-50 text-rose-700'
  return 'bg-slate-100 text-slate-700'
}

export function OpenLineagePage() {
  const [eventType, setEventType] = useState('all')
  const [jobName, setJobName] = useState('')
  const [runId, setRunId] = useState('')
  const statusQuery = useQuery({ queryKey: ['openlineage', 'status'], queryFn: api.getOpenLineageStatus })
  const jobsQuery = useQuery({
    queryKey: ['openlineage', 'jobs'],
    queryFn: () => api.listOpenLineageEvents({ limit: 500 }),
  })
  const eventsQuery = useQuery({
    queryKey: ['openlineage', 'events', eventType, jobName, runId],
    queryFn: () =>
      api.listOpenLineageEvents({
        event_type: eventType === 'all' ? undefined : eventType,
        job_name: jobName || undefined,
        run_id: runId.trim() || undefined,
        limit: 200,
      }),
  })

  const events = useMemo(() => eventsQuery.data?.items ?? [], [eventsQuery.data?.items])
  const jobNames = useMemo(
    () => Array.from(new Set((jobsQuery.data?.items ?? []).map((item) => item.event.job.name))).sort(),
    [jobsQuery.data?.items],
  )
  const counts = useMemo(
    () => ({
      total: events.length,
      started: events.filter((item) => item.event.eventType === 'START').length,
      completed: events.filter((item) => item.event.eventType === 'COMPLETE').length,
      failed: events.filter((item) => item.event.eventType === 'FAIL').length,
    }),
    [events],
  )

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operational Lineage"
        title="OpenLineage Events"
        description="Inspect standards-compatible run events emitted by DataWizz pipelines and notebooks, including resolved input and output datasets and optional external delivery status."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Visible Events</p>
          <p className="mt-2 font-display text-3xl text-ink">{counts.total}</p>
          <p className="mt-2 text-sm text-slate/70">{statusQuery.data?.event_count ?? 0} retained locally.</p>
        </Panel>
        <Panel>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Started</p>
          <p className="mt-2 font-display text-3xl text-lagoon">{counts.started}</p>
          <p className="mt-2 text-sm text-slate/70">Lifecycle start markers in the current result set.</p>
        </Panel>
        <Panel>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Completed</p>
          <p className="mt-2 font-display text-3xl text-emerald-700">{counts.completed}</p>
          <p className="mt-2 text-sm text-slate/70">Successful pipeline and notebook executions.</p>
        </Panel>
        <Panel>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Failed</p>
          <p className="mt-2 font-display text-3xl text-rose-700">{counts.failed}</p>
          <p className="mt-2 text-sm text-slate/70">{statusQuery.data?.delivery_failures ?? 0} external delivery failures.</p>
        </Panel>
      </div>

      <Panel className="grid gap-5 xl:grid-cols-[1fr_0.85fr]">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate/50">Event Type</p>
            <Select className="mt-3" value={eventType} onChange={(event) => setEventType(event.target.value)}>
              <option value="all">All event types</option>
              <option value="START">START</option>
              <option value="COMPLETE">COMPLETE</option>
              <option value="FAIL">FAIL</option>
            </Select>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate/50">Job</p>
            <Select className="mt-3" value={jobName} onChange={(event) => setJobName(event.target.value)}>
              <option value="">All jobs</option>
              {jobNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </Select>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate/50">Run ID</p>
            <Input className="mt-3" value={runId} onChange={(event) => setRunId(event.target.value)} placeholder="Exact run UUID" />
          </div>
        </div>

        <div className="rounded-2xl bg-cyan-50 p-4 text-sm text-lagoon">
          <p className="font-semibold">Transport</p>
          <p className="mt-2 leading-6">
            Mode: {statusQuery.data?.transport_mode ?? 'local'} · Namespace: {statusQuery.data?.namespace ?? 'datawizz://local'}
          </p>
          <p className="mt-2 break-all text-xs leading-5">
            {statusQuery.data?.transport_url || statusQuery.data?.events_path || 'Loading event-store location...'}
          </p>
        </div>
      </Panel>

      {events.length ? (
        <div className="space-y-3">
          {events.map((item, index) => {
            const event = item.event
            const datawizzFacet = event.run.facets.datawizz as Record<string, unknown> | undefined
            return (
              <Panel key={`${event.run.runId}-${event.eventType}-${event.eventTime}-${index}`}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="font-semibold text-ink">{event.job.name}</p>
                    <p className="mt-2 text-sm text-slate/70">
                      Run {event.run.runId} · {formatDate(event.eventTime)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${eventTone(event.eventType)}`}>{event.eventType}</span>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${deliveryTone(item.delivery.status)}`}>{item.delivery.status}</span>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate/50">Inputs</p>
                    <div className="mt-3 space-y-2">
                      {event.inputs.length ? event.inputs.map((dataset) => (
                        <div key={`${dataset.namespace}-${dataset.name}`} className="rounded-xl bg-white p-3 text-sm">
                          <p className="font-semibold text-ink">{dataset.name}</p>
                          <p className="mt-1 break-all text-xs text-slate/55">{dataset.namespace}</p>
                        </div>
                      )) : <p className="text-sm text-slate/65">No input datasets declared.</p>}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate/50">Outputs</p>
                    <div className="mt-3 space-y-2">
                      {event.outputs.length ? event.outputs.map((dataset) => (
                        <div key={`${dataset.namespace}-${dataset.name}`} className="rounded-xl bg-white p-3 text-sm">
                          <p className="font-semibold text-ink">{dataset.name}</p>
                          <p className="mt-1 break-all text-xs text-slate/55">{dataset.namespace}</p>
                        </div>
                      )) : <p className="text-sm text-slate/65">No output datasets declared.</p>}
                    </div>
                  </div>
                </div>

                {datawizzFacet ? (
                  <pre className="mt-4 overflow-x-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                    {JSON.stringify(datawizzFacet, null, 2)}
                  </pre>
                ) : null}
              </Panel>
            )
          })}
        </div>
      ) : (
        <EmptyState title="No OpenLineage events match" description="Run a saved pipeline or notebook, or clear the current filters." />
      )}
    </div>
  )
}
