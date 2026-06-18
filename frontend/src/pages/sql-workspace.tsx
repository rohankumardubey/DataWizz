import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/auth-context'
import { DataTable } from '../components/data-table'
import { MonacoSqlEditor } from '../components/monaco-sql-editor'
import { Button, Input, Label, PageHeader, Panel, Select } from '../components/ui'
import { useExecutionEngine } from '../engine/engine-context'
import { api } from '../lib/api'
import { formatDate } from '../lib/utils'
import { useTheme } from '../theme/theme-context'

const defaultSql = `SELECT *\nFROM raw_sales\nLIMIT 25`

function toRawViewName(fileName: string) {
  return `raw_${fileName.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')}`
}

export function SqlWorkspacePage() {
  const { hasAnyRole } = useAuth()
  const canEdit = hasAnyRole('admin', 'analyst')
  const { theme } = useTheme()
  const { activeEngineId } = useExecutionEngine()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const [sql, setSql] = useState(defaultSql)
  const [tableName, setTableName] = useState('sales_curated')
  const [deltaMode, setDeltaMode] = useState<'overwrite' | 'append'>('overwrite')
  const [deltaMessage, setDeltaMessage] = useState<string | null>(null)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)

  const historyQuery = useQuery({ queryKey: ['query-history'], queryFn: api.listQueryHistory })
  const filesQuery = useQuery({ queryKey: ['files'], queryFn: api.listFiles })
  const tablesQuery = useQuery({ queryKey: ['tables'], queryFn: api.listTables })
  const queryMutation = useMutation({
    mutationFn: api.executeQuery,
    onMutate: () => {
      setDeltaMessage(null)
      setQueryError(null)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['query-history'] })
    },
    onError: (error: Error) => {
      setQueryError(error.message)
    },
  })
  const deltaMutation = useMutation({
    mutationFn: api.writeDelta,
    onMutate: () => {
      setDeltaMessage(null)
      setQueryError(null)
    },
    onSuccess: (data) => {
      setDeltaMessage(`${data.message}: ${data.table.name}`)
      queryClient.invalidateQueries({ queryKey: ['tables'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] })
    },
    onError: (error: Error) => {
      setQueryError(error.message)
    },
  })
  const exportMutation = useMutation({
    mutationFn: async (format: 'csv' | 'parquet') => {
      const blob = await api.exportQuery({ sql, format, file_name: tableName || 'query_result' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${tableName || 'query_result'}.${format}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      return format
    },
    onMutate: () => {
      setQueryError(null)
      setExportMessage(null)
    },
    onSuccess: (format) => {
      setExportMessage(`${format.toUpperCase()} export started`)
    },
    onError: (error: Error) => {
      setQueryError(error.message)
    },
  })

  useEffect(() => {
    const selectedTable = searchParams.get('table')
    if (!selectedTable) return
    setTableName(selectedTable)
    setSql(`SELECT *\nFROM ${selectedTable}\nLIMIT 25`)
  }, [searchParams])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="DuckDB Workspace"
        title="SQL Workspace"
        description="Query raw files and curated Delta outputs through DuckDB, iterate quickly in Monaco, and publish results back into the curated zone."
        actions={
          canEdit ? <>
            <Button disabled={queryMutation.isPending} onClick={() => queryMutation.mutate({ sql, limit: 200 })}>
              {queryMutation.isPending ? 'Running...' : 'Run Query'}
            </Button>
            <Button tone="ghost" disabled={exportMutation.isPending} onClick={() => exportMutation.mutate('csv')}>
              {exportMutation.isPending ? 'Exporting...' : 'Export CSV'}
            </Button>
            <Button tone="ghost" disabled={exportMutation.isPending} onClick={() => exportMutation.mutate('parquet')}>
              {exportMutation.isPending ? 'Exporting...' : 'Export Parquet'}
            </Button>
            <button
              type="button"
              disabled={deltaMutation.isPending}
              onClick={() => deltaMutation.mutate({ table_name: tableName, sql, mode: deltaMode, schema_name: 'analytics' })}
              className="inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                backgroundColor: theme === 'dark' ? '#f6f24a' : '#0f172a',
                color: theme === 'dark' ? '#000000' : '#ffffff',
              }}
            >
              {deltaMutation.isPending ? 'Writing...' : 'Write Delta'}
            </button>
          </> : undefined
        }
      />

      {!canEdit ? (
        <Panel className="border-slate-200 bg-slate-50 text-sm text-slate-700">
          Your current role is read-only. You can inspect saved query history and sample outputs here, but query execution, exports, and Delta writes are limited to analysts and admins.
        </Panel>
      ) : null}

      {activeEngineId !== 'duckdb' ? (
        <Panel
          className="text-sm"
          style={
            theme === 'dark'
              ? {
                  borderColor: 'rgba(34, 211, 238, 0.18)',
                  backgroundColor: 'rgba(6, 182, 212, 0.08)',
                  color: '#cffafe',
                }
              : {
                  borderColor: '#bae6fd',
                  backgroundColor: '#ecfeff',
                  color: '#155e75',
                }
          }
        >
          <p className="font-semibold">Notebook engine selected: {activeEngineId}</p>
          <p className="mt-2 text-sm leading-6">
            The SQL Workspace remains DuckDB-backed for SQL execution and Delta publishing. Use the new Engine Lab tab for Spark or DataFusion notebook-style runtime selection.
          </p>
        </Panel>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.9fr]">
        <Panel className="space-y-4 p-0">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Query Editor</p>
              <h2 className="font-display text-2xl text-ink">Monaco SQL</h2>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate/70">Preview limit 200 rows</span>
          </div>
          <MonacoSqlEditor value={sql} onChange={setSql} height={340} readOnly={!canEdit} />
          <div className="border-t border-slate-100 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Queryable Views</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {filesQuery.data?.items?.map((file) => {
                const viewName = toRawViewName(file.name)
                return (
                  <button
                    key={file.id}
                    type="button"
                    className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700"
                    onClick={() => setSql(`SELECT *\nFROM ${viewName}\nLIMIT 25`)}
                  >
                    {viewName}
                  </button>
                )
              })}
              {tablesQuery.data?.items?.map((table) => (
                <button
                  key={table.id}
                  type="button"
                  className="rounded-full bg-cyan-100 px-3 py-1.5 text-xs font-medium text-lagoon"
                  onClick={() => setSql(`SELECT *\nFROM ${table.name}\nLIMIT 25`)}
                >
                  {table.name}
                </button>
              ))}
            </div>
            {!filesQuery.data?.items?.length && !tablesQuery.data?.items?.length ? (
              <p className="mt-3 text-sm text-slate/70">Upload a file first from File Explorer. Raw files appear as views like `raw_sales`.</p>
            ) : null}
          </div>
          <div className="grid gap-4 border-t border-slate-100 px-5 py-5 md:grid-cols-3">
            <div>
              <Label>Delta Table Name</Label>
              <Input value={tableName} onChange={(event) => setTableName(event.target.value)} disabled={!canEdit} />
            </div>
            <div>
              <Label>Write Mode</Label>
              <Select value={deltaMode} onChange={(event) => setDeltaMode(event.target.value as 'overwrite' | 'append')} disabled={!canEdit}>
                <option value="overwrite">overwrite</option>
                <option value="append">append</option>
              </Select>
            </div>
            <div className="flex items-end">
              <Button className="w-full" tone="ghost" onClick={() => setSql(defaultSql)} disabled={!canEdit}>
                Reset Example
              </Button>
            </div>
          </div>
          {queryError ? <div className="border-t border-rose-100 bg-rose-50 px-5 py-4 text-sm text-rose-700">{queryError}</div> : null}
          {exportMessage ? <div className="border-t border-sky-100 bg-sky-50 px-5 py-4 text-sm text-sky-700">{exportMessage}</div> : null}
          {deltaMessage ? <div className="border-t border-emerald-100 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">{deltaMessage}</div> : null}
        </Panel>

        <Panel>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Query History</p>
          <div className="mt-4 space-y-3">
            {historyQuery.data?.items?.map((item) => (
              <button
                key={item.id}
                type="button"
                className="w-full rounded-2xl border border-slate-100 bg-slate-50/80 p-4 text-left"
                onClick={() => setSql(item.sql_text)}
              >
                <p className="font-semibold text-ink">{item.name || 'Ad hoc query'}</p>
                <p className="mt-2 line-clamp-3 font-mono text-xs text-slate/70">{item.sql_text}</p>
                <div className="mt-3 flex items-center justify-between text-xs text-slate/55">
                  <span>{item.execution_ms ?? 0} ms</span>
                  <span>{formatDate(item.created_at)}</span>
                </div>
              </button>
            ))}
          </div>
        </Panel>
      </div>

      {queryMutation.data ? (
        <div className="space-y-4">
          <Panel className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Query Result</p>
              <h3 className="font-display text-2xl text-ink">
                {queryMutation.data.result.row_count} rows in {queryMutation.data.result.execution_ms} ms
              </h3>
            </div>
          </Panel>
          <DataTable columns={queryMutation.data.result.columns} rows={queryMutation.data.result.rows} />
        </div>
      ) : null}
    </div>
  )
}
