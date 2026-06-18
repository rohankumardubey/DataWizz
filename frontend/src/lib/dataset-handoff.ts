const STORAGE_KEY = 'datawizz_notebook_dataset_handoff'

export type NotebookDatasetHandoff = {
  source: 'notebook'
  notebookName: string
  cellId: string
  cellTitle?: string | null
  datasetName: string
  description?: string | null
  columns: string[]
  rows: Record<string, unknown>[]
  schema_json: { name: string; type: string }[]
}

export function saveNotebookDatasetHandoff(handoff: NotebookDatasetHandoff) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(handoff))
}

export function readNotebookDatasetHandoff(): NotebookDatasetHandoff | null {
  const raw = window.sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as NotebookDatasetHandoff
  } catch {
    window.sessionStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export function clearNotebookDatasetHandoff() {
  window.sessionStorage.removeItem(STORAGE_KEY)
}
