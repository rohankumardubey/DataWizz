import { useQuery } from '@tanstack/react-query'
import { Bell, Cpu, Database, GitBranch, LayoutDashboard, LineChart, LogOut, Logs, MoonStar, PlaySquare, Search, Settings2, Sigma, Sparkles, SunMedium, TableProperties, Workflow } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/auth-context'
import { BrandLogo } from './brand-logo'
import { useExecutionEngine } from '../engine/engine-context'
import { api } from '../lib/api'
import { cn, formatDate } from '../lib/utils'
import { useTheme } from '../theme/theme-context'

const navGroups = [
  {
    title: 'Lakehouse',
    items: [
      { label: 'Dashboard', to: '/', icon: LayoutDashboard, end: true },
      { label: 'File Explorer', to: '/files', icon: Database, end: true },
      { label: 'SQL Workspace', to: '/sql', icon: Sparkles, end: true },
      { label: 'Engine Lab', to: '/engines', icon: Cpu, end: true, roles: ['admin', 'analyst'] },
      { label: 'Catalog', to: '/catalog', icon: TableProperties, end: true },
      { label: 'Pipeline Builder', to: '/pipelines', icon: Workflow, end: true, roles: ['admin', 'analyst'] },
      { label: 'Pipeline Runs', to: '/runs', icon: PlaySquare, end: true },
      { label: 'Job Logs', to: '/logs', icon: Logs, end: true },
      { label: 'Lineage Events', to: '/lineage-events', icon: GitBranch, end: true },
    ],
  },
  {
    title: 'BI Layer',
    items: [
      { label: 'BI Home', to: '/bi', icon: LayoutDashboard, end: true },
      { label: 'Datasets', to: '/bi/datasets', icon: Database, end: true, roles: ['admin', 'analyst'] },
      { label: 'Metrics Layer', to: '/bi/metrics', icon: Sigma, end: true, roles: ['admin', 'analyst'] },
      { label: 'Metric Alerts', to: '/bi/alerts', icon: Bell, end: true, roles: ['admin', 'analyst'] },
      { label: 'Chart Builder', to: '/bi/charts/new', icon: LineChart, end: true, roles: ['admin', 'analyst'] },
      { label: 'Saved Charts', to: '/bi/charts', icon: LineChart, end: true },
      { label: 'Dashboard Builder', to: '/bi/dashboards/new', icon: LayoutDashboard, end: true, roles: ['admin', 'analyst'] },
      { label: 'Dashboard Viewer', to: '/bi/dashboards', icon: TableProperties, end: true },
      { label: 'Report Scheduler', to: '/bi/reports', icon: PlaySquare, end: true, roles: ['admin', 'analyst'] },
      { label: 'Superset', to: '/bi/superset', icon: Sparkles, end: true },
    ],
  },
]

function kindTone(kind: string) {
  if (kind === 'file') return 'bg-slate-100 text-slate-700'
  if (kind === 'table') return 'bg-cyan-50 text-lagoon'
  if (kind === 'pipeline') return 'bg-orange-50 text-orange-700'
  if (kind === 'dashboard') return 'bg-emerald-50 text-emerald-700'
  if (kind === 'chart') return 'bg-violet-50 text-violet-700'
  if (kind === 'metric') return 'bg-lime-50 text-emerald-700'
  return 'bg-slate-100 text-slate-700'
}

export function AppShell() {
  const { session, logout, hasAnyRole } = useAuth()
  const { activeEngineId } = useExecutionEngine()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const searchRef = useRef<HTMLDivElement | null>(null)
  const [search, setSearch] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const searchQuery = useQuery({
    queryKey: ['global-search', search],
    queryFn: () => api.globalSearch(search),
    enabled: search.trim().length >= 2,
  })

  const searchResults = searchQuery.data?.items ?? []
  const firstResult = useMemo(() => searchResults[0] ?? null, [searchResults])

  useEffect(() => {
    setIsSearchOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsSearchOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const navigateToResult = (route: string) => {
    setIsSearchOpen(false)
    setSearch('')
    navigate(route)
  }

  return (
    <div className={cn('app-shell-root min-h-screen', theme === 'dark' ? 'bg-[#0b0b0b]' : 'bg-[#f5f5f7]')}>
      <div className="flex min-h-screen">
        <aside
          className={cn(
            'app-sidebar hidden w-[292px] flex-col lg:flex',
            theme === 'dark' ? 'border-r border-white/10 bg-[#111111] text-white' : 'border-r border-slate-200 bg-white',
          )}
        >
          <div className={cn('px-6 py-5', theme === 'dark' ? 'border-b border-white/10' : 'border-b border-slate-200')}>
            <div className="flex items-center gap-3">
              <BrandLogo className="h-11 w-11 shrink-0" imageClassName="h-10 w-10" variant="icon" />
              <div>
                <p className={cn('font-display text-xl font-semibold', theme === 'dark' ? 'text-white' : 'text-slate-950')}>DataWizz</p>
                <p className={cn('text-xs uppercase tracking-[0.18em]', theme === 'dark' ? 'text-white/45' : 'text-slate-500')}>Lakehouse Platform</p>
              </div>
            </div>
          </div>

          <div className="px-4 py-4">
            <div
              className={cn(
                'rounded-lg px-4 py-3',
                theme === 'dark' ? 'border border-white/10 bg-white/[0.03]' : 'border border-slate-200 bg-slate-50',
              )}
            >
              <p className={cn('text-[11px] font-semibold uppercase tracking-[0.22em]', theme === 'dark' ? 'text-white/45' : 'text-slate-500')}>Workspace</p>
              <p className={cn('mt-2 text-sm font-semibold', theme === 'dark' ? 'text-white' : 'text-slate-900')}>DataWizz Demo</p>
              <p className={cn('mt-1 text-sm leading-6', theme === 'dark' ? 'text-white/68' : 'text-slate-600')}>Workspace for uploads, SQL, pipelines, and BI.</p>
              <p className={cn('mt-2 text-xs font-semibold uppercase tracking-[0.2em]', theme === 'dark' ? 'text-[#f6f24a]' : 'text-[#c62e1a]')}>
                Active engine: {activeEngineId}
              </p>
            </div>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-5">
            {navGroups.map((group) => (
              <div key={group.title}>
                <p className={cn('mb-3 px-2 text-[11px] font-semibold uppercase tracking-[0.22em]', theme === 'dark' ? 'text-white/42' : 'text-slate-500')}>{group.title}</p>
                <div className="space-y-1.5">
                  {group.items.filter((item) => !('roles' in item) || !item.roles || hasAnyRole(...item.roles)).map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition',
                          theme === 'dark'
                            ? isActive
                              ? 'bg-[#f6f24a] text-black'
                              : 'text-white/72 hover:bg-white/[0.05] hover:text-white'
                            : isActive
                              ? 'bg-[#fff1ef] text-[#c62e1a]'
                              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950',
                        )
                      }
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className={cn('px-4 py-4', theme === 'dark' ? 'border-t border-white/10' : 'border-t border-slate-200')}>
            <div
              className={cn(
                'rounded-lg p-4 text-sm',
                theme === 'dark' ? 'border border-white/10 bg-white/[0.03] text-white/72' : 'border border-slate-200 bg-white text-slate-700',
              )}
            >
              <p className={cn('font-semibold', theme === 'dark' ? 'text-white' : 'text-slate-900')}>Demo Mode</p>
              <p className="mt-2 leading-6">Local-first stack with DuckDB, Delta Lake, PostgreSQL metadata, and MinIO-ready storage paths.</p>
            </div>
            {hasAnyRole('admin') ? (
              <NavLink
                to="/settings"
                className={cn(
                  'mt-3 flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition',
                  theme === 'dark' ? 'text-white/72 hover:bg-white/[0.05] hover:text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950',
                )}
              >
                <Settings2 className="h-4 w-4" />
                Settings
              </NavLink>
            ) : null}
          </div>
        </aside>

        <div className="flex min-h-screen flex-1 flex-col">
          <header className={cn('app-topbar px-5 py-3 text-white', theme === 'dark' ? 'border-b border-white/10 bg-[#101010]' : 'border-b border-slate-200 bg-[#111827]')}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="lg:hidden">
                  <BrandLogo className="h-9 w-9 shrink-0" imageClassName="h-8 w-8" variant="icon" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">Workspace</p>
                  <p className="font-medium">DataWizz / Analytics Engineering</p>
                </div>
              </div>

              <div className="hidden max-w-xl flex-1 items-center justify-center md:flex">
                <div ref={searchRef} className="relative w-full max-w-xl">
                  <div
                    className={cn(
                      'app-search-box flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm',
                      theme === 'dark' ? 'border border-white/10 bg-white/[0.04] text-white/75' : 'border border-white/10 bg-white/5 text-white/75',
                    )}
                  >
                    <Search className="h-4 w-4" />
                    <input
                      value={search}
                      onFocus={() => setIsSearchOpen(true)}
                      onChange={(event) => {
                        setSearch(event.target.value)
                        setIsSearchOpen(true)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && firstResult) {
                          navigateToResult(firstResult.route)
                        }
                      }}
                      placeholder="Search files, tables, pipelines, dashboards"
                      className="w-full bg-transparent text-white placeholder:text-white/55 focus:outline-none"
                    />
                  </div>

                  {isSearchOpen && search.trim().length >= 2 ? (
                    <div
                      className={cn(
                        'app-search-panel absolute inset-x-0 top-[calc(100%+10px)] z-30 rounded-2xl p-3 shadow-2xl',
                        theme === 'dark' ? 'border border-white/10 bg-[#121212] text-white' : 'border border-slate-200 bg-white text-slate-900',
                      )}
                      style={
                        theme === 'dark'
                          ? undefined
                          : {
                              backgroundColor: '#ffffff',
                              color: '#0f172a',
                            }
                      }
                    >
                      {searchQuery.isLoading ? (
                        <p className={cn('px-3 py-3 text-sm', theme === 'dark' ? 'text-white/60' : 'text-slate-600')}>Searching the workspace...</p>
                      ) : searchResults.length ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between px-3 pb-1 pt-1">
                            <p className={cn('text-[11px] font-semibold uppercase tracking-[0.22em]', theme === 'dark' ? 'text-white/45' : 'text-slate-500')}>
                              Search Results
                            </p>
                            <span className={cn('text-xs', theme === 'dark' ? 'text-white/45' : 'text-slate-500')}>
                              {searchResults.length} matches
                            </span>
                          </div>
                          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                            {searchResults.map((result) => (
                              <button
                                key={`${result.kind}-${result.id}`}
                                type="button"
                                onClick={() => navigateToResult(result.route)}
                                className={cn(
                                  'flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition',
                                  theme === 'dark'
                                    ? 'border-transparent bg-white/[0.03] text-white hover:border-white/10 hover:bg-white/[0.06]'
                                    : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-slate-300 hover:bg-white',
                                )}
                                style={
                                  theme === 'dark'
                                    ? undefined
                                    : {
                                        backgroundColor: '#f8fafc',
                                        borderColor: '#e2e8f0',
                                        color: '#0f172a',
                                      }
                                }
                              >
                                <span className={`mt-0.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${kindTone(result.kind)}`}>
                                  {result.kind}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p
                                    className={cn('truncate text-sm font-semibold', theme === 'dark' ? 'text-white' : 'text-slate-900')}
                                    style={theme === 'dark' ? undefined : { color: '#0f172a' }}
                                  >
                                    {result.title || 'Untitled asset'}
                                  </p>
                                  <p
                                    className={cn('mt-1 line-clamp-2 text-sm leading-5', theme === 'dark' ? 'text-white/65' : 'text-slate-600')}
                                    style={theme === 'dark' ? undefined : { color: '#475569' }}
                                  >
                                    {result.subtitle || result.route}
                                  </p>
                                </div>
                                <span
                                  className={cn('shrink-0 pl-2 text-xs uppercase tracking-[0.18em]', theme === 'dark' ? 'text-white/38' : 'text-slate-400')}
                                  style={theme === 'dark' ? undefined : { color: '#64748b' }}
                                >
                                  {formatDate(result.updated_at)}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className={cn('px-3 py-3 text-sm', theme === 'dark' ? 'text-white/60' : 'text-slate-600')}>No matching assets found for this search.</p>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleTheme}
                  className={cn(
                    'rounded-lg p-2 transition',
                    theme === 'dark' ? 'border border-[#f6f24a]/20 bg-[#f6f24a]/10 text-[#f6f24a]' : 'border border-white/10 bg-white/5 text-white/85',
                  )}
                  aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
                >
                  {theme === 'dark' ? <SunMedium className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />}
                </button>
                <button className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/80">
                  <Bell className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-white">{session?.user.name ?? 'Workspace User'}</p>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/50">{session?.user.role ?? 'admin'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void logout()
                    }}
                    className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/75 transition hover:bg-white/10 hover:text-white"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </header>

          <main className={cn('app-main flex-1 px-4 py-4 sm:px-6', theme === 'dark' ? 'text-white' : '')}>
            <div className="mx-auto max-w-[1600px]">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
