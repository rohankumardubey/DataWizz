import { useQuery } from '@tanstack/react-query'
import { PageHeader, Panel, StatCard } from '../components/ui'
import { api } from '../lib/api'
import { formatBytes, formatDate } from '../lib/utils'
import { StatusBadge } from '../components/status-badge'
import { useTheme } from '../theme/theme-context'

export function DashboardPage() {
  const { theme } = useTheme()
  const { data } = useQuery({ queryKey: ['dashboard-metrics'], queryFn: api.getDashboardMetrics })

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lakehouse Overview"
        title="DataWizz Home"
        description="Monitor the ingestion layer, curated Delta assets, orchestration health, and reporting activity from one workspace landing page."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Files Uploaded" value={String(data?.total_files ?? 0)} accent="bg-[#fff1ef]" subtext="Raw landing-zone data available for profiling." />
        <StatCard label="Delta Tables" value={String(data?.total_delta_tables ?? 0)} accent="bg-slate-100" subtext="Curated outputs published into the catalog." />
        <StatCard label="Pipeline Runs" value={String(data?.total_pipeline_runs ?? 0)} accent="bg-slate-100" subtext="Execution history across visual flows." />
        <StatCard label="Failed Jobs" value={String(data?.failed_jobs ?? 0)} accent="bg-rose-100" subtext="Runs that need operator attention." />
        <StatCard label="Storage Usage" value={formatBytes(data?.storage_usage_bytes)} accent="bg-slate-100" subtext="Current local raw, curated, and temp footprint." />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
        <Panel className="overflow-hidden p-0">
          <div
            className={`border-b px-6 py-5 ${
              theme === 'dark' ? 'border-white/10 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-950'
            }`}
          >
            <p className={`text-[11px] font-semibold uppercase tracking-[0.22em] ${theme === 'dark' ? 'text-white/55' : 'text-slate-500'}`}>Workspace Summary</p>
            <h2 className="mt-2 font-display text-3xl">Build, run, and analyze data products in DataWizz</h2>
            <p className={`mt-3 max-w-3xl text-sm leading-7 ${theme === 'dark' ? 'text-white/72' : 'text-slate-700'}`}>
              This MVP already supports raw ingestion, SQL exploration, Delta publishing, drag-and-drop pipelines, and an in-app analytics layer. The remaining work is now about hardening, governance, and richer product polish.
            </p>
          </div>
          <div className="grid gap-4 px-6 py-5 md:grid-cols-3">
            {[
              { title: 'Ingest', text: 'Upload CSV, JSON, and Parquet files into the raw zone and profile them immediately.' },
              { title: 'Transform', text: 'Run ad hoc SQL in DuckDB or chain reusable visual pipeline nodes.' },
              { title: 'Consume', text: 'Publish Delta tables, model datasets, and compose business dashboards.' },
            ].map((item) => (
              <div key={item.title} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{item.title}</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">{item.text}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Recent Activity</p>
              <h3 className="mt-2 font-display text-2xl text-slate-950">Operator feed</h3>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">Last 8 events</div>
          </div>
          <div className="mt-4 space-y-3">
            {data?.recent_activity?.length ? (
              data.recent_activity.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">{item.title}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-slate-500">{item.kind}</p>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                  <p className="mt-3 text-sm text-slate-600">{formatDate(item.created_at)}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-600">Activity will appear here after uploads, queries, and pipeline runs.</p>
            )}
          </div>
        </Panel>
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <Panel>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Pending Product Work</p>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-700">
            <li>Flink streaming and external Airflow execution are not wired yet.</li>
            <li>Quality suites run on demand today; scheduled runs and pipeline quality gates are next.</li>
            <li>Semantic metrics, row-level security, and column masking remain TODO.</li>
          </ul>
        </Panel>
        <Panel>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Near-Term UX Gaps</p>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-700">
            <li>Pipeline node configuration is still JSON-heavy instead of fully form-driven.</li>
            <li>Query/table/file workflows need richer toasts, empty states, and success/error guidance.</li>
            <li>Dashboard authoring works, but still needs stronger layout polish and semantic modeling depth.</li>
          </ul>
        </Panel>
        <Panel>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Platform Direction</p>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-700">
            <li>Next engine extensions are Spark, Flink, and stronger object storage/native catalog integrations.</li>
            <li>Operational maturity should add monitoring, CI/CD, and Kubernetes deployment paths.</li>
            <li>The BI module can evolve toward a semantic layer and subscription-ready reporting system.</li>
          </ul>
        </Panel>
      </section>
    </div>
  )
}
