import { useEffect, useMemo, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from 'reactflow'
import 'reactflow/dist/style.css'
import type { DeltaTable, UploadedFile } from '../types'
import { Button, Input, Label, Panel, Select, Textarea } from './ui'

const pipelineTypes = [
  'fileSource',
  'deltaSource',
  'filter',
  'select',
  'join',
  'aggregate',
  'sql',
  'validate',
  'writeDelta',
  'schedule',
] as const

type PipelineNodeType = (typeof pipelineTypes)[number]

type BuilderNodeData = {
  label: string
  config: Record<string, unknown>
  type: string
}

type BuilderProps = {
  initialNodes: Node[]
  initialEdges: Edge[]
  onSave: (payload: { name: string; description: string; nodes: Node[]; edges: Edge[] }) => Promise<void>
  onValidate?: (payload: { nodes: Node[]; edges: Edge[] }) => Promise<void>
  onRun?: (payload: { nodes: Node[]; edges: Edge[] }) => Promise<void>
  name: string
  description: string
  scheduleCron: string
  setName: (value: string) => void
  setDescription: (value: string) => void
  setScheduleCron: (value: string) => void
  availableFiles: UploadedFile[]
  availableTables: DeltaTable[]
}

type InputOption = {
  id: string
  label: string
  type: string
}

type BuilderIssue = {
  nodeId: string | null
  severity: 'error' | 'warning'
  message: string
}

type PipelineTemplate = {
  id: string
  name: string
  summary: string
  build: (context: { availableFiles: UploadedFile[]; availableTables: DeltaTable[] }) => {
    pipelineName: string
    description: string
    scheduleCron: string
    nodes: Node<BuilderNodeData>[]
    edges: Edge[]
  }
}

const nodeDefaults: Record<PipelineNodeType, { label: string; config: Record<string, unknown> }> = {
  fileSource: { label: 'File Source', config: { fileId: '' } },
  deltaSource: { label: 'Delta Source', config: { tableId: '' } },
  filter: { label: 'Filter Rows', config: { condition: '1 = 1' } },
  select: { label: 'Select Columns', config: { columns: ['*'] } },
  join: { label: 'Join Datasets', config: { joinType: 'inner', leftKey: '', rightKey: '', leftSourceId: '', rightSourceId: '' } },
  aggregate: { label: 'Aggregate', config: { groupBy: [], metrics: [{ agg: 'sum', column: 'revenue', alias: 'total_revenue' }] } },
  sql: { label: 'SQL Transform', config: { sql: 'SELECT * FROM {{input_1}}' } },
  validate: { label: 'Validate Data', config: { minRows: 1 } },
  writeDelta: { label: 'Write Delta', config: { tableName: 'sales_curated', schemaName: 'analytics', mode: 'overwrite', description: '', qualityGate: 'off' } },
  schedule: { label: 'Schedule', config: { cron: '0 8 * * *', note: 'Daily 8 AM refresh' } },
}

const supportedJoinTypes = ['inner', 'left', 'right', 'full'] as const
const supportedAggregations = ['sum', 'avg', 'count', 'min', 'max'] as const

function titleizeType(type: string) {
  return type
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (char) => char.toUpperCase())
}

function normalizeNodeData(node: Node): BuilderNodeData {
  const base = nodeDefaults[(node.type ?? 'sql') as PipelineNodeType] ?? nodeDefaults.sql
  const data = (node.data as Record<string, unknown> | undefined) ?? {}
  const configFromNode = (data.config as Record<string, unknown> | undefined) ?? data

  return {
    label: String(data.label ?? base.label),
    config: { ...base.config, ...(configFromNode ?? {}) },
    type: String(node.type ?? data.type ?? 'sql'),
  }
}

function normalizeNodes(nodes: Node[]): Node<BuilderNodeData>[] {
  return nodes.map((node) => ({
    ...node,
    type: node.type ?? 'sql',
    data: normalizeNodeData(node),
  }))
}

function formatList(value: unknown) {
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => String(item).trim())
    .filter(Boolean)
    .join(', ')
}

function parseList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatMetrics(value: unknown) {
  if (!Array.isArray(value)) return ''
  return value
    .map((metric) => {
      if (!metric || typeof metric !== 'object') return ''
      const entry = metric as Record<string, unknown>
      return [entry.agg, entry.column, entry.alias].map((item) => String(item ?? '').trim()).join(':')
    })
    .filter(Boolean)
    .join('\n')
}

function parseMetrics(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [agg = 'count', column = '*', alias = 'metric'] = line.split(':').map((part) => part.trim())
      return { agg, column, alias }
    })
}

function nodeConfig(node: Node<BuilderNodeData>) {
  return node.data.config
}

function describeNode(data: BuilderNodeData) {
  const config = data.config
  switch (data.type) {
    case 'fileSource':
      return String(config.fileId || 'Pick a file')
    case 'deltaSource':
      return String(config.tableId || 'Pick a Delta table')
    case 'filter':
      return String(config.condition || 'No filter set')
    case 'select':
      return formatList(config.columns) || 'Select all columns'
    case 'join':
      return `${String(config.joinType || 'inner')} join`
    case 'aggregate':
      return formatList(config.groupBy) || 'Aggregate all rows'
    case 'sql':
      return 'Custom SQL step'
    case 'validate':
      return `Minimum rows: ${String(config.minRows || 1)}`
    case 'writeDelta':
      return `${String(config.tableName || 'Target table')} · quality ${String(config.qualityGate || 'off')}`
    case 'schedule':
      return String(config.cron || 'No schedule')
    default:
      return titleizeType(data.type)
  }
}

function BuilderNode({ data }: { data: BuilderNodeData }) {
  return (
    <div className="min-w-52 rounded-3xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate/55">{titleizeType(data.type)}</p>
      <p className="mt-2 font-display text-lg text-ink">{data.label}</p>
      <p className="mt-2 max-w-48 truncate text-xs text-slate/65">{describeNode(data)}</p>
    </div>
  )
}

const nodeTypes = Object.fromEntries(pipelineTypes.map((type) => [type, BuilderNode]))

function inputOptionsForNode(nodeId: string, nodes: Node<BuilderNodeData>[], edges: Edge[]): InputOption[] {
  return edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => nodes.find((node) => node.id === edge.source))
    .filter((node): node is Node<BuilderNodeData> => Boolean(node))
    .map((node) => ({
      id: node.id,
      label: node.data.label,
      type: String(node.type ?? node.data.type),
    }))
}

function buildGuardrails(
  nodes: Node<BuilderNodeData>[],
  edges: Edge[],
  availableFiles: UploadedFile[],
  availableTables: DeltaTable[],
): BuilderIssue[] {
  const issues: BuilderIssue[] = []
  const fileIds = new Set(availableFiles.map((file) => file.id))
  const tableIds = new Set(availableTables.map((table) => table.id))
  const nodeIds = nodes.map((node) => node.id)

  if (nodeIds.length !== new Set(nodeIds).size) {
    issues.push({ nodeId: null, severity: 'error', message: 'Node IDs must stay unique. Re-apply the template or remove the duplicate node.' })
  }

  if (!nodes.some((node) => node.type === 'writeDelta')) {
    issues.push({ nodeId: null, severity: 'warning', message: 'This pipeline does not currently publish a curated Delta table.' })
  }

  for (const node of nodes) {
    const config = nodeConfig(node)
    const incoming = inputOptionsForNode(node.id, nodes, edges)

    if (node.type === 'fileSource') {
      const fileId = String(config.fileId ?? '').trim()
      if (incoming.length) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'File source nodes cannot accept upstream connections.' })
      }
      if (!fileId) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'Choose an uploaded file for this source node.' })
      } else if (!fileIds.has(fileId)) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'The selected uploaded file no longer exists.' })
      }
      continue
    }

    if (node.type === 'deltaSource') {
      const tableId = String(config.tableId ?? '').trim()
      if (incoming.length) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'Delta source nodes cannot accept upstream connections.' })
      }
      if (!tableId) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'Choose a Delta table for this source node.' })
      } else if (!tableIds.has(tableId)) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'The selected Delta table no longer exists.' })
      }
      continue
    }

    if (node.type === 'join') {
      const leftSourceId = String(config.leftSourceId ?? '').trim()
      const rightSourceId = String(config.rightSourceId ?? '').trim()
      const leftKey = String(config.leftKey ?? '').trim()
      const rightKey = String(config.rightKey ?? '').trim()
      const joinType = String(config.joinType ?? 'inner').trim().toLowerCase()
      if (incoming.length !== 2) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'Join nodes must have exactly two upstream datasets.' })
      }
      if (!supportedJoinTypes.includes(joinType as (typeof supportedJoinTypes)[number])) {
        issues.push({ nodeId: node.id, severity: 'error', message: `Join type must be one of ${supportedJoinTypes.join(', ')}.` })
      }
      if (!leftKey || !rightKey) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'Provide both left and right join keys before validation.' })
      }
      if (incoming.length >= 2 && (!leftSourceId || !rightSourceId)) {
        issues.push({ nodeId: node.id, severity: 'warning', message: 'Map the connected upstream datasets explicitly so the left and right sides stay deterministic.' })
      }
      if (leftSourceId && !incoming.some((input) => input.id === leftSourceId)) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'The chosen left join input is not connected to this node.' })
      }
      if (rightSourceId && !incoming.some((input) => input.id === rightSourceId)) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'The chosen right join input is not connected to this node.' })
      }
      if (leftSourceId && rightSourceId && leftSourceId === rightSourceId) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'Left and right join inputs must be different upstream nodes.' })
      }
      continue
    }

    if (node.type === 'aggregate') {
      const metrics = Array.isArray(config.metrics) ? config.metrics : []
      if (incoming.length !== 1) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'Aggregate nodes must have exactly one upstream dataset.' })
      }
      if (!metrics.length) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'Add at least one metric in agg:column:alias format.' })
      }
      const aliases = new Set<string>()
      metrics.forEach((metric, index) => {
        const entry = metric as Record<string, unknown>
        const agg = String(entry?.agg ?? '').trim().toLowerCase()
        const column = String(entry?.column ?? '').trim()
        const alias = String(entry?.alias ?? '').trim()
        if (!supportedAggregations.includes(agg as (typeof supportedAggregations)[number])) {
          issues.push({ nodeId: node.id, severity: 'error', message: `Metric ${index + 1} must use ${supportedAggregations.join(', ')}.` })
        }
        if (!column || !alias) {
          issues.push({ nodeId: node.id, severity: 'error', message: `Metric ${index + 1} needs both a source column and an alias.` })
        }
        if (alias) {
          if (aliases.has(alias)) {
            issues.push({ nodeId: node.id, severity: 'error', message: `Metric alias \`${alias}\` is duplicated.` })
          }
          aliases.add(alias)
        }
      })
      continue
    }

    if (node.type === 'sql') {
      const sql = String(config.sql ?? '').trim()
      if (!incoming.length) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'SQL transforms need at least one upstream dataset.' })
      }
      if (!sql) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'Add the SQL statement for this transform node.' })
      }
      if (incoming.length > 1) {
        const missingPlaceholders = incoming.filter((_, index) => !sql.includes(`{{input_${index + 1}}}`))
        if (missingPlaceholders.length) {
          issues.push({ nodeId: node.id, severity: 'warning', message: 'Reference each upstream dataset with placeholders like {{input_1}} and {{input_2}}.' })
        }
      }
      continue
    }

    if (node.type === 'schedule') {
      if (incoming.length || edges.some((edge) => edge.source === node.id)) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'Schedule nodes are metadata only and should stay disconnected from the DAG.' })
      }
      if (!String(config.cron ?? '').trim()) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'Add a cron expression for this schedule node.' })
      }
      continue
    }

    if (node.type === 'filter' && !String(config.condition ?? '').trim()) {
      issues.push({ nodeId: node.id, severity: 'error', message: 'Filter nodes need a SQL condition.' })
    }
    if (node.type === 'select' && !formatList(config.columns).trim()) {
      issues.push({ nodeId: node.id, severity: 'error', message: 'Select nodes need at least one column or *.' })
    }
    if (node.type === 'validate' && Number(config.minRows ?? 1) < 1) {
      issues.push({ nodeId: node.id, severity: 'error', message: 'Validation minimum rows must be at least 1.' })
    }
    if (node.type === 'writeDelta') {
      if (!String(config.tableName ?? '').trim()) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'Write Delta nodes need a target table name.' })
      }
      const mode = String(config.mode ?? 'overwrite').trim()
      if (!['overwrite', 'append'].includes(mode)) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'Write mode must be overwrite or append.' })
      }
      const qualityGate = String(config.qualityGate ?? 'off').trim()
      if (!['off', 'warn', 'block'].includes(qualityGate)) {
        issues.push({ nodeId: node.id, severity: 'error', message: 'Quality gate must be off, warn, or block.' })
      }
    }
    if (!['fileSource', 'deltaSource', 'schedule'].includes(String(node.type)) && incoming.length === 0) {
      issues.push({ nodeId: node.id, severity: 'error', message: `${titleizeType(String(node.type))} nodes require an upstream input.` })
    }
  }

  return issues
}

const pipelineTemplates: PipelineTemplate[] = [
  {
    id: 'sql-curation',
    name: 'SQL Curation',
    summary: 'Start from one raw file, transform it in SQL, then publish a curated Delta table.',
    build: ({ availableFiles }) => ({
      pipelineName: 'Sales Curated Pipeline',
      description: 'Read a raw sales file, transform it with SQL, and publish a curated Delta table.',
      scheduleCron: '0 8 * * *',
      nodes: [
        {
          id: 'fileSource_1',
          type: 'fileSource',
          position: { x: 40, y: 120 },
          data: { label: 'Raw Sales', config: { fileId: availableFiles[0]?.id ?? '' }, type: 'fileSource' },
        },
        {
          id: 'sql_2',
          type: 'sql',
          position: { x: 320, y: 120 },
          data: { label: 'SQL Transform', config: { sql: 'SELECT * FROM {{input_1}}' }, type: 'sql' },
        },
        {
          id: 'writeDelta_3',
          type: 'writeDelta',
          position: { x: 620, y: 120 },
          data: { label: 'Write Delta', config: { tableName: 'sales_curated', schemaName: 'analytics', mode: 'overwrite', description: '' }, type: 'writeDelta' },
        },
      ],
      edges: [
        { id: 'edge_1', source: 'fileSource_1', target: 'sql_2' },
        { id: 'edge_2', source: 'sql_2', target: 'writeDelta_3' },
      ],
    }),
  },
  {
    id: 'join-enrichment',
    name: 'Join Enrichment',
    summary: 'Combine two upstream datasets with explicit left/right mapping, then publish the enriched result.',
    build: ({ availableFiles }) => ({
      pipelineName: 'Customer Order Enrichment',
      description: 'Join orders with customer attributes and publish an enriched curated Delta table.',
      scheduleCron: '0 9 * * 1-5',
      nodes: [
        {
          id: 'fileSource_1',
          type: 'fileSource',
          position: { x: 40, y: 80 },
          data: { label: 'Orders', config: { fileId: availableFiles[0]?.id ?? '' }, type: 'fileSource' },
        },
        {
          id: 'fileSource_2',
          type: 'fileSource',
          position: { x: 40, y: 260 },
          data: { label: 'Customers', config: { fileId: availableFiles[1]?.id ?? '' }, type: 'fileSource' },
        },
        {
          id: 'join_3',
          type: 'join',
          position: { x: 340, y: 180 },
          data: {
            label: 'Join Orders + Customers',
            config: { joinType: 'left', leftKey: 'customer_id', rightKey: 'customer_id', leftSourceId: 'fileSource_1', rightSourceId: 'fileSource_2' },
            type: 'join',
          },
        },
        {
          id: 'writeDelta_4',
          type: 'writeDelta',
          position: { x: 650, y: 180 },
          data: { label: 'Write Delta', config: { tableName: 'customer_orders_curated', schemaName: 'analytics', mode: 'overwrite', description: '' }, type: 'writeDelta' },
        },
      ],
      edges: [
        { id: 'edge_1', source: 'fileSource_1', target: 'join_3' },
        { id: 'edge_2', source: 'fileSource_2', target: 'join_3' },
        { id: 'edge_3', source: 'join_3', target: 'writeDelta_4' },
      ],
    }),
  },
  {
    id: 'aggregation-mart',
    name: 'Aggregation Mart',
    summary: 'Roll up a source dataset into KPI-style metrics with prefilled aggregate definitions.',
    build: ({ availableFiles, availableTables }) => ({
      pipelineName: 'Regional Revenue Mart',
      description: 'Aggregate sales by region and publish a metric-friendly Delta table for dashboards.',
      scheduleCron: '30 7 * * *',
      nodes: [
        {
          id: 'fileSource_1',
          type: availableTables.length ? 'deltaSource' : 'fileSource',
          position: { x: 40, y: 120 },
          data:
            availableTables.length
              ? { label: 'Curated Sales', config: { tableId: availableTables[0]?.id ?? '' }, type: 'deltaSource' }
              : { label: 'Raw Sales', config: { fileId: availableFiles[0]?.id ?? '' }, type: 'fileSource' },
        },
        {
          id: 'aggregate_2',
          type: 'aggregate',
          position: { x: 340, y: 120 },
          data: {
            label: 'Revenue Rollup',
            config: {
              groupBy: ['region'],
              metrics: [
                { agg: 'sum', column: 'amount', alias: 'total_amount' },
                { agg: 'count', column: '*', alias: 'order_count' },
                { agg: 'avg', column: 'amount', alias: 'avg_order_amount' },
              ],
            },
            type: 'aggregate',
          },
        },
        {
          id: 'writeDelta_3',
          type: 'writeDelta',
          position: { x: 650, y: 120 },
          data: { label: 'Write Delta', config: { tableName: 'regional_revenue_mart', schemaName: 'analytics', mode: 'overwrite', description: '' }, type: 'writeDelta' },
        },
      ],
      edges: [
        { id: 'edge_1', source: 'fileSource_1', target: 'aggregate_2' },
        { id: 'edge_2', source: 'aggregate_2', target: 'writeDelta_3' },
      ],
    }),
  },
]

type NodeFieldsProps = {
  node: Node<BuilderNodeData>
  availableFiles: UploadedFile[]
  availableTables: DeltaTable[]
  updateConfig: (patch: Record<string, unknown>) => void
  inputOptions: InputOption[]
}

function NodeFields({ node, availableFiles, availableTables, updateConfig, inputOptions }: NodeFieldsProps) {
  const config = node.data.config

  switch (node.type) {
    case 'fileSource':
      return (
        <div className="space-y-4">
          <div>
            <Label>Uploaded File</Label>
            <Select value={String(config.fileId ?? '')} onChange={(event) => updateConfig({ fileId: event.target.value })}>
              <option value="">Select a file</option>
              {availableFiles.map((file) => (
                <option key={file.id} value={file.id}>
                  {file.name}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-xs leading-5 text-slate/65">This node exposes the selected file as an input dataset for downstream transforms.</p>
        </div>
      )
    case 'deltaSource':
      return (
        <div className="space-y-4">
          <div>
            <Label>Delta Table</Label>
            <Select value={String(config.tableId ?? '')} onChange={(event) => updateConfig({ tableId: event.target.value })}>
              <option value="">Select a Delta table</option>
              {availableTables.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.schema_name}.{table.name}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-xs leading-5 text-slate/65">Use a curated table as the upstream source for another pipeline.</p>
        </div>
      )
    case 'filter':
      return (
        <div className="space-y-4">
          <div>
            <Label>Filter Condition</Label>
            <Textarea
              rows={4}
              value={String(config.condition ?? '')}
              onChange={(event) => updateConfig({ condition: event.target.value })}
              placeholder="order_total > 100 AND region = 'West'"
            />
          </div>
        </div>
      )
    case 'select':
      return (
        <div className="space-y-4">
          <div>
            <Label>Columns</Label>
            <Input
              value={formatList(config.columns)}
              onChange={(event) => updateConfig({ columns: parseList(event.target.value) || ['*'] })}
              placeholder="order_id, customer_id, amount"
            />
          </div>
          <p className="text-xs leading-5 text-slate/65">Separate columns with commas. Leave as `*` to keep everything.</p>
        </div>
      )
    case 'join':
      return (
        <div className="space-y-4">
          <div className="rounded-2xl bg-cyan-50 p-3 text-sm text-lagoon">
            <p className="font-semibold">Join Guardrail</p>
            <p className="mt-2 leading-6">Connect exactly two upstream nodes, then map each one explicitly so the left and right sides stay stable even if edges move around.</p>
          </div>
          <div>
            <Label>Join Type</Label>
            <Select value={String(config.joinType ?? 'inner')} onChange={(event) => updateConfig({ joinType: event.target.value })}>
              {supportedJoinTypes.map((joinType) => (
                <option key={joinType} value={joinType}>
                  {joinType}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Left Input</Label>
              <Select value={String(config.leftSourceId ?? '')} onChange={(event) => updateConfig({ leftSourceId: event.target.value })}>
                <option value="">Select connected node</option>
                {inputOptions.map((input) => (
                  <option key={input.id} value={input.id}>
                    {input.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Right Input</Label>
              <Select value={String(config.rightSourceId ?? '')} onChange={(event) => updateConfig({ rightSourceId: event.target.value })}>
                <option value="">Select connected node</option>
                {inputOptions.map((input) => (
                  <option key={input.id} value={input.id}>
                    {input.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Left Key</Label>
              <Input value={String(config.leftKey ?? '')} onChange={(event) => updateConfig({ leftKey: event.target.value })} placeholder="customer_id" />
            </div>
            <div>
              <Label>Right Key</Label>
              <Input value={String(config.rightKey ?? '')} onChange={(event) => updateConfig({ rightKey: event.target.value })} placeholder="customer_id" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              tone="ghost"
              className="text-xs"
              onClick={() => {
                if (inputOptions.length >= 2) {
                  updateConfig({ leftSourceId: inputOptions[0].id, rightSourceId: inputOptions[1].id })
                }
              }}
            >
              Use Connected Inputs
            </Button>
          </div>
        </div>
      )
    case 'aggregate':
      return (
        <div className="space-y-4">
          <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate/70">
            <p className="font-semibold text-ink">Aggregate Guardrail</p>
            <p className="mt-2 leading-6">Keep one upstream dataset, define at least one metric, and make every metric alias unique so dashboards can reference them cleanly.</p>
          </div>
          <div>
            <Label>Group By Columns</Label>
            <Input
              value={formatList(config.groupBy)}
              onChange={(event) => updateConfig({ groupBy: parseList(event.target.value) })}
              placeholder="region, order_month"
            />
          </div>
          <div>
            <Label>Metrics</Label>
            <Textarea
              rows={6}
              value={formatMetrics(config.metrics)}
              onChange={(event) => updateConfig({ metrics: parseMetrics(event.target.value) })}
              placeholder={'sum:amount:total_amount\ncount:*:order_count'}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              tone="ghost"
              className="text-xs"
              onClick={() =>
                updateConfig({
                  groupBy: ['region'],
                  metrics: [
                    { agg: 'sum', column: 'revenue', alias: 'total_revenue' },
                    { agg: 'count', column: '*', alias: 'order_count' },
                  ],
                })
              }
            >
              Revenue Rollup Example
            </Button>
            <Button
              tone="ghost"
              className="text-xs"
              onClick={() =>
                updateConfig({
                  groupBy: ['order_date'],
                  metrics: [
                    { agg: 'count', column: '*', alias: 'row_count' },
                    { agg: 'avg', column: 'revenue', alias: 'avg_revenue' },
                  ],
                })
              }
            >
              Daily KPI Example
            </Button>
          </div>
          <p className="text-xs leading-5 text-slate/65">Use one metric per line in `agg:column:alias` format. Supported aggregations: {supportedAggregations.join(', ')}.</p>
        </div>
      )
    case 'sql':
      return (
        <div className="space-y-4">
          <div>
            <Label>SQL Transform</Label>
            <Textarea
              rows={10}
              value={String(config.sql ?? '')}
              onChange={(event) => updateConfig({ sql: event.target.value })}
              placeholder={'SELECT *\nFROM {{input_1}}'}
            />
          </div>
          <p className="text-xs leading-5 text-slate/65">
            Reference upstream nodes with placeholders like <code>{'{{input_1}}'}</code> and <code>{'{{input_2}}'}</code>.
          </p>
        </div>
      )
    case 'validate':
      return (
        <div className="space-y-4">
          <div>
            <Label>Minimum Rows</Label>
            <Input
              type="number"
              min={1}
              value={String(config.minRows ?? 1)}
              onChange={(event) => updateConfig({ minRows: Number(event.target.value || 1) })}
            />
          </div>
          <p className="text-xs leading-5 text-slate/65">The run fails if the upstream dataset has fewer rows than this threshold.</p>
        </div>
      )
    case 'writeDelta':
      return (
        <div className="space-y-4">
          <div>
            <Label>Table Name</Label>
            <Input value={String(config.tableName ?? '')} onChange={(event) => updateConfig({ tableName: event.target.value })} placeholder="sales_curated" />
          </div>
          <div>
            <Label>Schema Name</Label>
            <Input value={String(config.schemaName ?? 'analytics')} onChange={(event) => updateConfig({ schemaName: event.target.value })} placeholder="analytics" />
          </div>
          <div>
            <Label>Write Mode</Label>
            <Select value={String(config.mode ?? 'overwrite')} onChange={(event) => updateConfig({ mode: event.target.value })}>
              <option value="overwrite">overwrite</option>
              <option value="append">append</option>
            </Select>
          </div>
          <div>
            <Label>Post-write Quality Gate</Label>
            <Select value={String(config.qualityGate ?? 'off')} onChange={(event) => updateConfig({ qualityGate: event.target.value })}>
              <option value="off">Off — do not run the table suite</option>
              <option value="warn">Warn — record failures and continue</option>
              <option value="block">Block — stop downstream nodes on critical failures</option>
            </Select>
            <p className="mt-2 text-xs leading-5 text-slate/65">
              The gate runs the target table&apos;s saved quality suite immediately after the Delta write.
            </p>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              rows={4}
              value={String(config.description ?? '')}
              onChange={(event) => updateConfig({ description: event.target.value })}
              placeholder="Curated sales output for BI dashboards"
            />
          </div>
        </div>
      )
    case 'schedule':
      return (
        <div className="space-y-4">
          <div>
            <Label>Cron Expression</Label>
            <Input value={String(config.cron ?? '')} onChange={(event) => updateConfig({ cron: event.target.value })} placeholder="0 8 * * *" />
          </div>
          <div>
            <Label>Schedule Note</Label>
            <Textarea rows={4} value={String(config.note ?? '')} onChange={(event) => updateConfig({ note: event.target.value })} placeholder="Runs every weekday before business reporting." />
          </div>
          <p className="text-xs leading-5 text-slate/65">This is pipeline schedule metadata that can be reused for future orchestration integrations.</p>
        </div>
      )
    default:
      return <p className="text-sm text-slate/70">Select any node on the canvas to edit its configuration.</p>
  }
}

export function PipelineBuilder({
  initialNodes,
  initialEdges,
  onSave,
  onValidate,
  onRun,
  name,
  description,
  scheduleCron,
  setName,
  setDescription,
  setScheduleCron,
  availableFiles,
  availableTables,
}: BuilderProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNodeData>(normalizeNodes(initialNodes))
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialNodes[0]?.id ?? null)

  useEffect(() => {
    setNodes(normalizeNodes(initialNodes))
    setSelectedNodeId(initialNodes[0]?.id ?? null)
  }, [initialNodes, setNodes])

  useEffect(() => {
    setEdges(initialEdges)
  }, [initialEdges, setEdges])

  useEffect(() => {
    if (!nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(nodes[0]?.id ?? null)
    }
  }, [nodes, selectedNodeId])

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId) ?? null, [nodes, selectedNodeId])
  const selectedInputOptions = useMemo(
    () => (selectedNode ? inputOptionsForNode(selectedNode.id, nodes, edges) : []),
    [selectedNode, nodes, edges],
  )
  const builderIssues = useMemo(() => buildGuardrails(nodes, edges, availableFiles, availableTables), [nodes, edges, availableFiles, availableTables])
  const selectedNodeIssues = useMemo(
    () => builderIssues.filter((issue) => issue.nodeId === null || issue.nodeId === selectedNodeId),
    [builderIssues, selectedNodeId],
  )
  const blockingIssues = builderIssues.filter((issue) => issue.severity === 'error')

  const addNode = (type: PipelineNodeType) => {
    const nextId = `${type}_${nodes.length + 1}`
    const base = nodeDefaults[type]
    setNodes((current) => [
      ...current,
      {
        id: nextId,
        type,
        position: { x: 60 + current.length * 28, y: 60 + current.length * 18 },
        data: { label: base.label, config: { ...base.config }, type },
      },
    ])
    setSelectedNodeId(nextId)
  }

  const applyTemplate = (template: PipelineTemplate) => {
    const result = template.build({ availableFiles, availableTables })
    setName(result.pipelineName)
    setDescription(result.description)
    setScheduleCron(result.scheduleCron)
    setNodes(normalizeNodes(result.nodes))
    setEdges(result.edges)
    setSelectedNodeId(result.nodes[0]?.id ?? null)
  }

  const onConnect = (connection: Edge | Connection) => setEdges((current) => addEdge({ ...connection, id: `edge_${current.length + 1}` }, current))

  const updateSelectedLabel = (label: string) => {
    if (!selectedNode) return
    setNodes((current) =>
      current.map((node) => (node.id === selectedNode.id ? { ...node, data: { ...node.data, label } } : node)),
    )
  }

  const updateSelectedConfig = (patch: Record<string, unknown>) => {
    if (!selectedNode) return
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              data: {
                ...node.data,
                config: { ...node.data.config, ...patch },
              },
            }
          : node,
      ),
    )
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)_380px]">
      <Panel className="space-y-5">
        <div>
          <Label>Pipeline Name</Label>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Sales Curated Pipeline" />
        </div>
        <div>
          <Label>Description</Label>
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="Join raw sales and customers, then publish a curated Delta table." />
        </div>
        <div>
          <Label>Schedule (Cron)</Label>
          <Input value={scheduleCron} onChange={(event) => setScheduleCron(event.target.value)} placeholder="0 8 * * *" />
          <p className="mt-2 text-xs leading-5 text-slate/65">Stored with the pipeline now so later scheduling and Airflow integration can reuse it.</p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Starter Templates</Label>
            <span className="text-[11px] uppercase tracking-[0.22em] text-slate/45">Blueprints</span>
          </div>
          <div className="space-y-3">
            {pipelineTemplates.map((template) => (
              <div key={template.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="font-semibold text-ink">{template.name}</p>
                <p className="mt-2 text-sm leading-6 text-slate/70">{template.summary}</p>
                <Button className="mt-3 w-full" tone="ghost" onClick={() => applyTemplate(template)}>
                  Apply Template
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <Label>Node Palette</Label>
          <div className="mt-3 flex flex-wrap gap-2">
            {pipelineTypes.map((type) => (
              <Button key={type} tone="ghost" className="text-xs" onClick={() => addNode(type)}>
                {titleizeType(type)}
              </Button>
            ))}
          </div>
        </div>

        <div className={`rounded-2xl p-4 text-sm ${blockingIssues.length ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
          <p className="font-semibold">{blockingIssues.length ? 'Guardrails need attention' : 'Builder health looks good'}</p>
          <p className="mt-2 leading-6">
            {blockingIssues.length
              ? `${blockingIssues.length} blocking issue${blockingIssues.length === 1 ? '' : 's'} found. Fix the node-level guardrails on the right before running.`
              : 'No blocking issues detected in the current graph. You can validate or run with confidence.'}
          </p>
        </div>

        <div className="space-y-3">
          <Button onClick={() => onSave({ name, description, nodes, edges })}>Save Pipeline</Button>
          {onValidate ? (
            <Button tone="secondary" onClick={() => onValidate({ nodes, edges })}>
              Validate
            </Button>
          ) : null}
          {onRun ? (
            <Button tone="ghost" disabled={blockingIssues.length > 0} onClick={() => onRun({ nodes, edges })}>
              Run Now
            </Button>
          ) : null}
        </div>

        <div className="space-y-4 border-t border-slate-100 pt-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Available Files</p>
            <div className="mt-3 space-y-2">
              {availableFiles.length ? (
                availableFiles.map((file) => (
                  <div key={file.id} className="rounded-2xl bg-slate-50 px-3 py-2 text-sm">
                    <p className="font-medium text-ink">{file.name}</p>
                    <p className="mt-1 truncate font-mono text-[11px] text-slate/60">{file.id}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate/70">Upload files first to use them as pipeline sources.</p>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Curated Tables</p>
            <div className="mt-3 space-y-2">
              {availableTables.length ? (
                availableTables.map((table) => (
                  <div key={table.id} className="rounded-2xl bg-cyan-50 px-3 py-2 text-sm text-lagoon">
                    <p className="font-medium">{table.schema_name}.{table.name}</p>
                    <p className="mt-1 truncate font-mono text-[11px] text-lagoon/70">{table.id}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate/70">Delta outputs appear here once you publish a curated table.</p>
              )}
            </div>
          </div>
        </div>
      </Panel>

      <Panel className="h-[760px] overflow-hidden p-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          fitView
        >
          <MiniMap />
          <Controls />
          <Background color="#d7dde5" gap={24} />
        </ReactFlow>
      </Panel>

      <Panel className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Node Config</p>
            <h3 className="font-display text-2xl text-ink">{selectedNode?.data.label ?? 'Select a node'}</h3>
            <p className="mt-1 text-sm text-slate/65">{selectedNode ? titleizeType(String(selectedNode.type)) : 'No node selected'}</p>
          </div>
          {selectedNode ? (
            <Button
              tone="danger"
              onClick={() => {
                setNodes((current) => current.filter((node) => node.id !== selectedNode.id))
                setEdges((current) => current.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id))
                setSelectedNodeId(null)
              }}
            >
              Remove
            </Button>
          ) : null}
        </div>

        {selectedNode ? (
          <>
            <div>
              <Label>Node Label</Label>
              <Input value={selectedNode.data.label} onChange={(event) => updateSelectedLabel(event.target.value)} />
            </div>

            {selectedInputOptions.length ? (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate/70">
                <p className="font-semibold text-ink">Connected Inputs</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedInputOptions.map((input) => (
                    <span key={input.id} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700">
                      {input.label}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <NodeFields
              node={selectedNode}
              availableFiles={availableFiles}
              availableTables={availableTables}
              updateConfig={updateSelectedConfig}
              inputOptions={selectedInputOptions}
            />

            <div className="space-y-3 border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Node Guardrails</p>
              {selectedNodeIssues.length ? (
                <div className="space-y-2">
                  {selectedNodeIssues.map((issue, index) => (
                    <div
                      key={`${issue.message}-${index}`}
                      className={`rounded-2xl px-4 py-3 text-sm ${
                        issue.severity === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {issue.message}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  This node is configured cleanly based on its current upstream connections.
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate/55">Config Preview</p>
              <pre className="mt-3 overflow-x-auto rounded-3xl bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100">
                {JSON.stringify(selectedNode.data.config, null, 2)}
              </pre>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate/70">Select any node on the canvas to configure its inputs, transforms, or write behavior.</p>
        )}
      </Panel>
    </div>
  )
}
