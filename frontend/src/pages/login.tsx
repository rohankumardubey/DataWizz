import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/auth-context'
import { BrandLogo } from '../components/brand-logo'
import { Input, Panel } from '../components/ui'

const SEEDED_ACCOUNTS = [
  { label: 'Admin', email: 'admin@datawizz.local', role: 'Full workspace access' },
  { label: 'Analyst', email: 'analyst@datawizz.local', role: 'Curate, build, and publish' },
  { label: 'Viewer', email: 'viewer@datawizz.local', role: 'Read-only dashboard access' },
]

export function LoginPage() {
  const { isAuthenticated, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('admin@datawizz.local')
  const [password, setPassword] = useState('datawizz123')

  const from = (location.state as { from?: string } | undefined)?.from || '/'

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: () => {
      navigate(from, { replace: true })
    },
  })

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#090909] text-white">
      <div className="h-3 w-full bg-[#f6f24a]" />
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_11%_14%,rgba(246,242,74,0.16),transparent_26%),radial-gradient(circle_at_80%_18%,rgba(92,117,255,0.12),transparent_20%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent_36%)]" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.14) 1px, transparent 1px)',
            backgroundSize: '68px 68px',
          }}
        />

        <div className="relative mx-auto flex min-h-[calc(100vh-0.75rem)] max-w-[1600px] items-center px-4 py-8 sm:px-6 lg:px-10">
          <div className="grid w-full gap-8 xl:grid-cols-[1.08fr_0.92fr] xl:gap-10">
            <section className="flex flex-col justify-between rounded-[40px] border border-white/10 bg-[linear-gradient(160deg,rgba(255,255,255,0.055),rgba(255,255,255,0.02))] p-8 shadow-[0_32px_120px_rgba(0,0,0,0.52)] backdrop-blur md:p-10">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-white/65">
                    Lakehouse
                  </span>
                  <span className="rounded-full bg-[#f6f24a] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-black">
                    Warehouse
                  </span>
                  <span className="rounded-full border border-[#4c61ff]/25 bg-[#4c61ff]/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#c7d0ff]">
                    Internal Analytics OS
                  </span>
                </div>

                <div className="mt-8 max-w-4xl">
                  <p className="text-sm font-medium uppercase tracking-[0.32em] text-white/45">DataWizz Workspace</p>
                  <h1 className="mt-5 max-w-4xl font-display text-[3.5rem] leading-[0.92] text-white sm:text-[4.5rem] xl:text-[5.6rem]">
                    The modern
                    <br />
                    control plane
                    <br />
                    for data work.
                  </h1>
                  <p className="mt-6 max-w-2xl text-lg leading-8 text-white/68 sm:text-[1.18rem]">
                    Upload raw files, model them with SQL, publish Delta tables, orchestrate pipelines, run notebooks, and ship dashboards from one governed in-house platform.
                  </p>
                </div>

                <div className="mt-8 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-[30px] border border-[#f6f24a]/20 bg-[#f6f24a]/8 p-5 shadow-[inset_0_0_0_1px_rgba(246,242,74,0.05)]">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#f6f24a]">Operating Promise</p>
                    <p className="mt-3 text-xl font-semibold text-white">One workspace for ingestion, orchestration, notebooks, and BI delivery.</p>
                    <p className="mt-3 text-sm leading-6 text-white/62">
                      Designed for analytics engineering teams that want platform-grade workflows without scattering context across five separate tools.
                    </p>
                  </div>
                  <div className="rounded-[30px] border border-white/10 bg-black/25 p-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/45">Core Surface</p>
                    <div className="mt-4 space-y-3 text-sm text-white/72">
                      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                        <span>Lakehouse</span>
                        <span className="font-semibold text-white">DuckDB + Delta</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                        <span>Notebook Runtime</span>
                        <span className="font-semibold text-white">Spark + DataFusion</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                        <span>BI Delivery</span>
                        <span className="font-semibold text-white">Native + Superset</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-10 grid gap-4 md:grid-cols-3">
                <div className="rounded-[30px] border border-white/10 bg-black/35 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#f6f24a]">01 Lakehouse</p>
                  <p className="mt-4 text-xl font-semibold text-white">Files, SQL, Delta, Catalog</p>
                  <p className="mt-3 text-sm leading-6 text-white/58">Ingest local and object-backed assets, preview schemas, and publish curated Delta outputs.</p>
                </div>
                <div className="rounded-[30px] border border-white/10 bg-black/35 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#f6f24a]">02 Pipelines</p>
                  <p className="mt-4 text-xl font-semibold text-white">Visual jobs with scheduling</p>
                  <p className="mt-3 text-sm leading-6 text-white/58">Build joins, aggregations, retries, logs, and recurring runs through a low-code canvas.</p>
                </div>
                <div className="rounded-[30px] border border-white/10 bg-black/35 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#f6f24a]">03 BI Layer</p>
                  <p className="mt-4 text-xl font-semibold text-white">Charts, dashboards, reports</p>
                  <p className="mt-3 text-sm leading-6 text-white/58">Model semantic datasets, assemble dashboards, and schedule exported report artifacts.</p>
                </div>
              </div>
            </section>

            <section className="flex items-center">
              <Panel className="w-full rounded-[40px] border border-white/10 bg-[linear-gradient(180deg,#141414,#121212)] p-8 text-white shadow-[0_28px_100px_rgba(0,0,0,0.5)] md:p-9">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <BrandLogo
                      className="h-14 w-14 rounded-2xl border border-white/10 bg-[#111111] p-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                      imageClassName="h-full w-full"
                      variant="icon"
                    />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/45">Workspace Access</p>
                      <p className="mt-2 font-display text-3xl leading-none text-white">Sign in to DataWizz</p>
                      <p className="mt-3 max-w-md text-sm leading-6 text-white/68">
                        Enter the analytics workspace for lakehouse operations, notebooks, orchestration, dashboards, and reporting.
                      </p>
                    </div>
                  </div>
                  <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-200">
                    Auth Active
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  {SEEDED_ACCOUNTS.map((account) => (
                    <button
                      key={account.email}
                      type="button"
                      onClick={() => {
                        setEmail(account.email)
                        setPassword('datawizz123')
                      }}
                      className={`rounded-full border px-3 py-2 text-left text-[12px] font-semibold transition ${
                        email === account.email
                          ? 'border-[#f6f24a]/45 bg-[#f6f24a]/12 text-[#f8f59a]'
                          : 'border-white/10 bg-white/[0.03] text-white/65 hover:border-white/20 hover:bg-white/[0.05]'
                      }`}
                    >
                      {account.label}
                    </button>
                  ))}
                </div>

                <div className="mt-8 grid gap-4 rounded-[30px] border border-white/10 bg-white/[0.03] p-5">
                  <div className="grid gap-2">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/55">Email</label>
                    <Input
                      className="h-14 rounded-2xl border-white/10 bg-[#0d0d0d] px-4 text-base text-white placeholder:text-white/30 focus:border-[#f6f24a] focus:ring-[#f6f24a]/15"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="admin@datawizz.local"
                    />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/55">Password</label>
                    <Input
                      className="h-14 rounded-2xl border-white/10 bg-[#0d0d0d] px-4 text-base text-white placeholder:text-white/30 focus:border-[#f6f24a] focus:ring-[#f6f24a]/15"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="datawizz123"
                    />
                  </div>

                  {loginMutation.error ? (
                    <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                      {(loginMutation.error as Error).message || 'Sign-in failed. Check the seeded credentials and try again.'}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    disabled={loginMutation.isPending}
                    onClick={() => loginMutation.mutate({ email, password })}
                    className="mt-2 inline-flex h-14 w-full items-center justify-center rounded-2xl bg-[#f6f24a] px-5 text-base font-semibold text-black shadow-[0_16px_30px_rgba(246,242,74,0.16)] transition hover:bg-[#fff968] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {loginMutation.isPending ? 'Signing In...' : 'Enter Workspace'}
                  </button>

                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/58">
                    <span>Shared password for local demo accounts</span>
                    <span className="font-mono text-white">datawizz123</span>
                  </div>
                </div>

                <div className="mt-6 rounded-[30px] border border-[#f6f24a]/20 bg-[#f6f24a]/10 p-5 text-sm text-white">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-white">Access Status</p>
                    <span className="rounded-full border border-[#f6f24a]/25 bg-black/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#fbf8a1]">
                      Seeded roles
                    </span>
                  </div>
                  <p className="mt-3 leading-6 text-white/74">
                    Use one of the seeded workspace accounts below to enter the platform with the right role scope, then continue directly into the lakehouse and BI workspace.
                  </p>
                </div>

                <div className="mt-6 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                  <div className="rounded-[30px] border border-white/10 bg-white/[0.03] p-5 text-sm text-white/72">
                    <p className="font-semibold text-white">Workspace Accounts</p>
                    <div className="mt-3 space-y-4 leading-6">
                      {SEEDED_ACCOUNTS.map((account) => (
                        <div key={account.email}>
                          <span className="text-white/45">{account.label}</span>
                          <br />
                          <span className="font-mono text-white">{account.email}</span>
                          <br />
                          <span className="text-xs text-white/48">{account.role}</span>
                        </div>
                      ))}
                      <div>
                        <span className="text-white/45">Password</span>
                        <br />
                        <span className="font-mono text-white">datawizz123</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[30px] border border-white/10 bg-white/[0.03] p-5 text-sm text-white/72">
                    <p className="font-semibold text-white">Platform Snapshot</p>
                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                        <span className="text-white/45">Execution Engine</span>
                        <span className="whitespace-nowrap text-right font-semibold text-white">DuckDB + Delta</span>
                      </div>
                      <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                        <span className="text-white/45">Storage Model</span>
                        <span className="whitespace-nowrap text-right font-semibold text-white">Raw / Curated zones</span>
                      </div>
                      <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                        <span className="text-white/45">Experience</span>
                        <span className="whitespace-nowrap text-right font-semibold text-white">Low-code + SQL</span>
                      </div>
                      <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                        <span className="text-white/45">Embedded BI</span>
                        <span className="whitespace-nowrap text-right font-semibold text-white">Superset + Native</span>
                      </div>
                    </div>
                  </div>
                </div>
              </Panel>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
