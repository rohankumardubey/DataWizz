import { useQuery } from '@tanstack/react-query'
import { PageHeader, Panel, StatCard } from '../components/ui'
import { api } from '../lib/api'

export function BiHomePage() {
  const datasetsQuery = useQuery({ queryKey: ['bi', 'datasets'], queryFn: api.listDatasets })
  const metricsQuery = useQuery({ queryKey: ['bi', 'metrics'], queryFn: api.listMetrics })
  const alertsQuery = useQuery({ queryKey: ['bi', 'metric-alerts'], queryFn: api.listMetricAlerts })
  const chartsQuery = useQuery({ queryKey: ['bi', 'charts'], queryFn: api.listCharts })
  const dashboardsQuery = useQuery({ queryKey: ['bi', 'dashboards'], queryFn: api.listDashboards })

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reporting Layer"
        title="BI and Dashboarding"
        description="Turn curated Delta Lake assets into reusable datasets, visual charts, and dashboards that feel closer to an internal Superset or Databricks SQL experience."
      />

      <section className="grid gap-4 lg:grid-cols-5">
        <StatCard label="Datasets" value={String((datasetsQuery.data?.items?.length ?? 0) + (datasetsQuery.data?.candidates?.length ?? 0))} accent="bg-gradient-to-br from-cyan-200 to-lagoon" subtext="Stored semantic datasets plus available curated candidates." />
        <StatCard label="Metrics" value={String(metricsQuery.data?.items?.length ?? 0)} accent="bg-gradient-to-br from-lime-200 to-emerald-500" subtext="Certified business definitions for reusable KPIs." />
        <StatCard label="Alerts" value={String(alertsQuery.data?.items?.length ?? 0)} accent="bg-gradient-to-br from-rose-200 to-red-500" subtext="Local threshold checks over governed metrics." />
        <StatCard label="Charts" value={String(chartsQuery.data?.items?.length ?? 0)} accent="bg-gradient-to-br from-orange-200 to-signal" subtext="Saved KPI, trend, and categorical visualizations." />
        <StatCard label="Dashboards" value={String(dashboardsQuery.data?.items?.length ?? 0)} accent="bg-gradient-to-br from-sky-200 to-blue-500" subtext="Layout-managed reporting surfaces for internal stakeholders." />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_1fr]">
        <Panel className="bg-hero-grid">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Demo Narrative</p>
          <h2 className="mt-3 font-display text-3xl text-ink">Build a “Sales Analytics Dashboard” directly on curated Delta tables</h2>
          <ol className="mt-5 space-y-3 text-sm leading-7 text-slate/75">
            <li>1. Upload `sales.csv` and `customers.csv` into the raw zone.</li>
            <li>2. Curate a final Delta table through SQL or the pipeline builder.</li>
            <li>3. Register a semantic dataset and create KPI, line, bar, and pie charts.</li>
            <li>4. Assemble those visualizations into a presentable dashboard layout.</li>
          </ol>
        </Panel>
        <Panel>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Roadmap Hooks</p>
          <div className="mt-4 space-y-3 text-sm text-slate/75">
            {[
              'Natural language to chart generation',
              'Embedded analytics and dashboard sharing',
              'Metric-to-chart handoff with certified KPI templates',
              'External alert delivery for Slack, email, and webhooks',
            ].map((item) => (
              <div key={item} className="rounded-2xl bg-slate-50 p-4">
                {item}
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </div>
  )
}
