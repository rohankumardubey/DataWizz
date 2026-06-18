import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button, PageHeader, Panel } from '../components/ui'
import { StatusBadge } from '../components/status-badge'
import { api } from '../lib/api'

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => {
      setCopied(false)
    }, 1600)
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate/50">{label}</p>
      <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <code className="overflow-x-auto rounded-xl bg-slate-950 px-3 py-2 text-xs text-slate-100">{value}</code>
        <Button tone="ghost" className="shrink-0" onClick={() => void handleCopy()}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  )
}

export function SupersetSetupPage() {
  const queryClient = useQueryClient()
  const [iframeKey, setIframeKey] = useState(0)
  const integrationQuery = useQuery({
    queryKey: ['system', 'superset'],
    queryFn: api.getSupersetIntegrationStatus,
    refetchInterval: 10000,
  })
  const embedLaunchQuery = useQuery({
    queryKey: ['system', 'superset', 'embed-launch', iframeKey],
    queryFn: () => api.getSupersetEmbedLaunchUrl('/superset/welcome/'),
    enabled: Boolean(integrationQuery.data?.reachable),
    refetchOnWindowFocus: false,
    staleTime: 0,
    retry: 1,
  })
  const syncMutation = useMutation({
    mutationFn: api.syncSupersetServingCatalog,
    onSuccess: (payload) => {
      queryClient.setQueryData(['system', 'superset'], payload)
    },
  })
  const provisionMutation = useMutation({
    mutationFn: api.provisionSupersetConnection,
    onSuccess: (payload) => {
      queryClient.setQueryData(['system', 'superset'], payload)
    },
  })
  const externalLaunchMutation = useMutation({
    mutationFn: () => api.getSupersetEmbedLaunchUrl('/superset/welcome/'),
    onSuccess: ({ launch_url }) => {
      window.open(launch_url, '_blank', 'noopener,noreferrer')
    },
  })

  const integration = integrationQuery.data
  const embedLaunchUrl = embedLaunchQuery.data?.launch_url
  const servingCatalog = integration?.serving_catalog
  const autoConnection = integration?.auto_connection
  const curatedAndSemanticAssets = (servingCatalog?.assets ?? []).filter((asset) => asset.asset_kind !== 'raw_file')
  const syncFeedback = syncMutation.isSuccess ? 'Serving catalog resynced successfully.' : null
  const provisionFeedback = provisionMutation.isSuccess
    ? autoConnection?.provisioned
      ? 'Superset connection is provisioned and ready.'
      : 'Provision command completed. Refresh status to confirm the new connection.'
    : null
  const actionError = syncMutation.error ?? provisionMutation.error ?? embedLaunchQuery.error ?? externalLaunchMutation.error
  const healthDetail = integrationQuery.isLoading
    ? 'Checking Superset health...'
    : integration?.detail ?? 'Superset health endpoint responded successfully.'
  const lastSyncedAt = servingCatalog?.last_synced_at
    ? new Date(servingCatalog.last_synced_at).toLocaleString()
    : null

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Optional BI Integration"
        title="Embedded Superset Workspace"
        description="Run Superset as a managed DataWizz runtime and keep it inside the workspace experience instead of treating it like a separate demo tab."
        actions={
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => provisionMutation.mutate()} disabled={!integration?.reachable || provisionMutation.isPending}>
              {provisionMutation.isPending ? 'Provisioning Connection...' : (autoConnection?.provisioned ? 'Repair Superset Connection' : 'Auto-Provision Connection')}
            </Button>
            <Button tone="ghost" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
              {syncMutation.isPending ? 'Resyncing Catalog...' : 'Resync Serving Catalog'}
            </Button>
            {integration?.reachable ? (
              <Button tone="ghost" onClick={() => setIframeKey((current) => current + 1)}>
                Refresh Embedded View
              </Button>
            ) : null}
            {integration?.reachable && integration?.login?.ui_url ? (
              <Button tone="ghost" onClick={() => externalLaunchMutation.mutate()} disabled={externalLaunchMutation.isPending}>
                {externalLaunchMutation.isPending ? 'Opening Superset...' : 'Open External Superset'}
              </Button>
            ) : null}
          </div>
        }
      />

      {actionError ? (
        <Panel className="border-rose-200 bg-rose-50 text-rose-700">
          {(actionError as Error).message || 'Superset action failed. Check the local runtime logs and try again.'}
        </Panel>
      ) : null}

      {syncFeedback || provisionFeedback ? (
        <Panel className="border-emerald-200 bg-emerald-50 text-emerald-700">
          {provisionFeedback ?? syncFeedback}
        </Panel>
      ) : null}

      <Panel className="overflow-hidden p-0">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">In-App Surface</p>
            <h2 className="mt-2 font-display text-3xl text-ink">Superset inside DataWizz</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate/75">
              When the managed runtime is healthy, the same Superset instance is rendered below inside the DataWizz shell. This keeps the BI story inside one workspace while still running Superset as its own proper service.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={integration?.status ?? 'checking'} />
            {integration?.setup?.local_command ? <code className="rounded-xl bg-slate-950 px-3 py-2 text-xs text-slate-100">{integration.setup.local_command}</code> : null}
          </div>
        </div>
        {integration?.reachable && integration?.login?.ui_url ? (
          embedLaunchUrl ? (
            <iframe
              key={embedLaunchUrl}
              title="Embedded Superset"
              src={embedLaunchUrl}
              className="h-[860px] w-full bg-white"
            />
          ) : (
            <div className="grid place-items-center px-5 py-16">
              <div className="max-w-lg rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Preparing Session</p>
                <h3 className="mt-2 font-display text-2xl text-ink">Signing you into Superset automatically</h3>
                <p className="mt-3 text-sm leading-6 text-slate/75">
                  DataWizz is creating a fresh embedded Superset browser session before loading the BI surface.
                </p>
              </div>
            </div>
          )
        ) : (
          <div className="grid gap-4 px-5 py-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Launch Required</p>
              <h3 className="mt-2 font-display text-2xl text-ink">Superset is not reachable yet</h3>
              <p className="mt-3 text-sm leading-6 text-slate/75">
                Start the managed runtime with the local launcher command below, then refresh this page. Once healthy, DataWizz will render the Superset UI directly inside this panel.
              </p>
              <div className="mt-4 space-y-3">
                <CopyField label="Recommended Local Command" value={integration?.setup.local_command ?? './run.sh local superset'} />
                <CopyField label="Force Native Command" value={integration?.setup.native_command ?? './run.sh local superset native'} />
                <CopyField label="Docker Command" value={integration?.setup.compose_command ?? 'docker compose --profile superset up --build'} />
              </div>
            </div>
            <div className="rounded-2xl bg-cyan-50 p-5 text-lagoon">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-lagoon/70">What this gives you</p>
              <div className="mt-4 space-y-3 text-sm leading-6">
                <div className="rounded-2xl bg-white px-4 py-3">One launcher path for DataWizz plus Superset.</div>
                <div className="rounded-2xl bg-white px-4 py-3">An embedded BI surface that still uses real Superset under the hood.</div>
                <div className="rounded-2xl bg-white px-4 py-3">A clean next step toward guest-token embedding and tighter SSO later.</div>
              </div>
            </div>
          </div>
        )}
      </Panel>

      <section className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Health Status</p>
          <div className="mt-3 flex items-center gap-3">
            <StatusBadge status={integration?.status ?? 'checking'} />
            <span className="text-sm text-slate/70">{healthDetail}</span>
          </div>
        </Panel>
        <Panel>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Superset URL</p>
          <p className="mt-3 text-lg font-semibold text-ink">{integration?.login.ui_url ?? 'http://localhost:8088'}</p>
          <p className="mt-2 text-sm text-slate/70">Expected local UI endpoint for the optional Superset profile.</p>
        </Panel>
        <Panel>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">HTTP Check</p>
          <p className="mt-3 text-lg font-semibold text-ink">{integration?.http_status ?? 'N/A'}</p>
          <p className="mt-2 text-sm text-slate/70">Polled from the backend against the Superset health endpoint.</p>
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Auto Connection</p>
          <div className="mt-3 flex items-center gap-3">
            <StatusBadge status={autoConnection?.provisioned ? 'success' : 'pending'} />
            <span className="text-sm text-slate/70">
              {autoConnection?.provisioned
                ? `${autoConnection.name} is already registered in Superset.`
                : 'DataWizz has not registered the serving-catalog connection in Superset yet.'}
            </span>
          </div>
          {autoConnection?.provisioned && lastSyncedAt ? (
            <p className="mt-3 text-xs uppercase tracking-[0.2em] text-slate/50">Last synced {lastSyncedAt}</p>
          ) : null}
        </Panel>
        <Panel>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Runtime Mode</p>
          <p className="mt-3 text-lg font-semibold text-ink">{autoConnection?.runtime_mode ?? 'unknown'}</p>
          <p className="mt-2 text-sm text-slate/70">Used to choose the correct host or Docker-visible DuckDB path during auto-provisioning.</p>
        </Panel>
        <Panel>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Superset Database ID</p>
          <p className="mt-3 text-lg font-semibold text-ink">{autoConnection?.database_id ?? 'Not registered'}</p>
          <p className="mt-2 text-sm text-slate/70">Superset-side identifier for the auto-managed DataWizz connection.</p>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Serving Catalog</p>
              <h2 className="mt-2 font-display text-2xl text-ink">Superset-Ready DataWizz Source</h2>
              <p className="mt-3 text-sm leading-6 text-slate/75">
                DataWizz now materializes raw files, curated Delta tables, and semantic datasets into one shared DuckDB catalog so Superset can browse real platform data instead of metadata-only tables.
              </p>
            </div>
            <StatusBadge status={servingCatalog?.catalog_status ?? 'checking'} />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate/50">Raw</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{servingCatalog?.asset_counts.raw_files ?? 0}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate/50">Curated</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{servingCatalog?.asset_counts.curated_tables ?? 0}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate/50">Semantic</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{servingCatalog?.asset_counts.semantic_datasets ?? 0}</p>
            </div>
          </div>
          <CopyField label="Host SQLAlchemy URI" value={servingCatalog?.host_sqlalchemy_uri ?? 'duckdb:////absolute/path/to/datawizz_superset.duckdb'} />
          <CopyField label="Docker SQLAlchemy URI" value={servingCatalog?.container_sqlalchemy_uri ?? 'duckdb:////datawizz-storage/serving/datawizz_superset.duckdb'} />
          <CopyField label="Shared DuckDB Path" value={servingCatalog?.database_path ?? 'storage/serving/datawizz_superset.duckdb'} />
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate/50">Auto-Provisioned Target</p>
            <p className="mt-3 font-semibold text-ink">{autoConnection?.name ?? 'DataWizz Serving Catalog'}</p>
            <p className="mt-2 text-sm leading-6 text-slate/75">
              DataWizz uses this exact URI when it auto-registers the Superset database connection.
            </p>
            <div className="mt-4">
              <CopyField label="Provisioned SQLAlchemy URI" value={autoConnection?.expected_sqlalchemy_uri ?? servingCatalog?.host_sqlalchemy_uri ?? 'duckdb:////absolute/path/to/datawizz_superset.duckdb'} />
            </div>
          </div>
          <div className="rounded-2xl bg-cyan-50 p-4 text-lagoon">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-lagoon/70">How to access it in Superset</p>
            <div className="mt-3 space-y-2 text-sm leading-6">
              <p>1. Start DataWizz with Superset enabled and let the auto-provision step complete.</p>
              <p>2. Open Superset and look for the <span className="font-semibold">{autoConnection?.name ?? 'DataWizz Serving Catalog'}</span> database.</p>
              <p>3. Explore the `raw`, `analytics`, and `semantic` schemas for synced DataWizz assets.</p>
            </div>
          </div>
        </Panel>

        <Panel className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Synced Assets</p>
            <h2 className="mt-2 font-display text-2xl text-ink">What Superset Can Read</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {(servingCatalog?.schemas ?? []).map((schemaName) => (
              <span key={schemaName} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate/70">
                {schemaName}
              </span>
            ))}
          </div>
          <div className="space-y-3">
            {curatedAndSemanticAssets.length ? (
              curatedAndSemanticAssets.slice(0, 8).map((asset) => (
                <div key={`${asset.object_schema}.${asset.object_name}`} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{asset.object_schema}.{asset.object_name}</p>
                      <p className="mt-1 text-sm text-slate/70">{asset.display_name}</p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate/65">
                      {asset.asset_kind === 'semantic_dataset' ? 'semantic' : 'curated'}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate/75">{asset.description}</p>
                </div>
              ))
            ) : (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate/70">
                No curated or semantic assets have been synced yet. Publish a Delta table or register a semantic dataset, then resync the serving catalog.
              </div>
            )}
          </div>
          {servingCatalog?.last_error ? (
            <div className="rounded-2xl bg-rose-50 p-4 text-sm leading-6 text-rose-700">
              Last sync error: {servingCatalog.last_error}
            </div>
          ) : null}
        </Panel>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.05fr_minmax(0,0.95fr)]">
        <div className="space-y-5">
          <Panel className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Launch Path</p>
              <h2 className="mt-2 font-display text-3xl text-ink">Bring Up Superset Alongside DataWizz</h2>
              <p className="mt-3 text-sm leading-6 text-slate/75">
                Use the local launcher when you want DataWizz plus Superset together. It can use Docker when present or a native Python runtime when Docker is unavailable.
              </p>
            </div>
            <CopyField label="Local Launcher" value={integration?.setup.local_command ?? './run.sh local superset'} />
            <CopyField label="Force Native Launcher" value={integration?.setup.native_command ?? './run.sh local superset native'} />
            <CopyField label="Auto Launcher" value={integration?.setup.auto_command ?? './run.sh auto superset'} />
            <CopyField label="Compose Command" value={integration?.setup.compose_command ?? 'docker compose --profile superset up --build'} />
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate/50">Setup Notes</p>
              <div className="mt-3 space-y-3 text-sm leading-6 text-slate/75">
                {(integration?.setup.notes ?? []).map((note) => (
                  <div key={note} className="rounded-2xl bg-white p-4">
                    {note}
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Credentials</p>
              <h2 className="mt-2 font-display text-2xl text-ink">Default Demo Login</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <CopyField label="Username" value={integration?.login.username ?? 'admin'} />
              <CopyField label="Password" value={integration?.login.password ?? 'admin'} />
            </div>
            <CopyField label="Health Check URL" value={integration?.checked_url ?? 'http://localhost:8088/health'} />
          </Panel>

          <Panel className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Sample Connections</p>
              <h2 className="mt-2 font-display text-2xl text-ink">Connection Details For Demo Storytelling</h2>
            </div>
            <div className="space-y-4">
              {(integration?.sample_connections ?? []).map((connection) => (
                <div key={connection.label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="font-semibold text-ink">{connection.label}</p>
                      <p className="mt-2 text-sm leading-6 text-slate/70">{connection.purpose}</p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <CopyField label="SQLAlchemy URI" value={connection.sqlalchemy_uri} />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Demo Narrative</p>
              <h2 className="mt-2 font-display text-2xl text-ink">How To Present This In A Stakeholder Demo</h2>
            </div>
            <div className="space-y-3 text-sm leading-7 text-slate/75">
              {[
                '1. Show the curated sales dashboard inside DataWizz first.',
                '2. Open Superset and highlight that the same platform can support an external BI surface.',
                '3. Create a Superset DuckDB connection using the serving-catalog URI above.',
                '4. Explore synced raw, curated, or semantic schemas and build a quick matching KPI or bar chart.',
                '5. Position this as proof that DataWizz can power both internal lakehouse workflows and broader analytics tooling.',
              ].map((step) => (
                <div key={step} className="rounded-2xl bg-slate-50 p-4">
                  {step}
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Sample Datasets</p>
              <h2 className="mt-2 font-display text-2xl text-ink">Suggested Tables To Showcase</h2>
            </div>
            <div className="space-y-3">
              {(integration?.sample_datasets ?? []).map((dataset) => (
                <div key={`${dataset.schema}.${dataset.name}`} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <p className="font-semibold text-ink">{dataset.schema}.{dataset.name}</p>
                  <p className="mt-2 text-sm leading-6 text-slate/70">{dataset.description}</p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Positioning</p>
              <h2 className="mt-2 font-display text-2xl text-ink">Why This Helps The DataWizz Story</h2>
            </div>
            <div className="space-y-3 text-sm leading-6 text-slate/75">
              {[
                'It shows that curated assets are not trapped inside a single UI.',
                'It demonstrates a practical upgrade path toward Trino, semantic governance, and external BI tools.',
                'It makes the platform feel closer to Databricks SQL, Snowflake, and modern enterprise analytics stacks.',
              ].map((point) => (
                <div key={point} className="rounded-2xl bg-cyan-50 p-4 text-lagoon">
                  {point}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
