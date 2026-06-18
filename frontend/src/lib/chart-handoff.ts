const STORAGE_KEY = 'datawizz_notebook_chart_handoff'

export type NotebookChartHandoff = {
  source: 'notebook'
  notebookName: string
  cellId: string
  cellTitle?: string | null
  chartName: string
  chartType: string
  categoryKey?: string | null
  valueKey?: string | null
  columns: string[]
  rows: Record<string, unknown>[]
}

export type ChartSnapshot = {
  source: string
  notebookName?: string | null
  cellId?: string | null
  cellTitle?: string | null
  columns: string[]
  rows: Record<string, unknown>[]
}

export function saveNotebookChartHandoff(handoff: NotebookChartHandoff) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(handoff))
}

export function readNotebookChartHandoff(): NotebookChartHandoff | null {
  const raw = window.sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as NotebookChartHandoff
  } catch {
    window.sessionStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export function clearNotebookChartHandoff() {
  window.sessionStorage.removeItem(STORAGE_KEY)
}

export function getChartSnapshot(config: Record<string, unknown>): ChartSnapshot | null {
  const rows = config.snapshotRows
  const columns = config.snapshotColumns
  if (!Array.isArray(rows) || !Array.isArray(columns)) return null

  return {
    source: typeof config.snapshotSource === 'string' ? config.snapshotSource : 'snapshot',
    notebookName: typeof config.snapshotNotebookName === 'string' ? config.snapshotNotebookName : null,
    cellId: typeof config.snapshotCellId === 'string' ? config.snapshotCellId : null,
    cellTitle: typeof config.snapshotCellTitle === 'string' ? config.snapshotCellTitle : null,
    columns: columns.map(String),
    rows: rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row)),
  }
}
