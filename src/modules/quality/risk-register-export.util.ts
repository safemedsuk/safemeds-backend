import ExcelJS from 'exceljs'

/**
 * Phase 2 Pass C — risk register export. Pure row building plus CSV and
 * Excel writers, kept separate from the service so the column contract
 * is unit-testable without a database.
 */

export const RISK_REGISTER_COLUMNS = [
  'Title',
  'Method',
  'Severity',
  'Probability',
  'Detectability',
  'Score',
  'Risk level',
  'Mitigation',
  'Linked CAPA',
  'Source record type',
  'Source reference',
  'Created by',
  'Created at',
  'Updated at',
] as const

export const RISK_METHOD_LABELS: Record<string, string> = {
  fmea: 'FMEA',
  fault_tree: 'Fault tree',
  risk_matrix_2x2: 'Risk matrix (2×2)',
  haccp: 'HACCP',
  other: 'Other',
}

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  deviation: 'Deviation',
  oos: 'OOS investigation',
  complaint: 'Complaint',
  change_control: 'Change control',
  recall: 'Recall',
  batch: 'Batch',
  product: 'Product',
  capa: 'CAPA',
}

export interface RiskRegisterSourceInput {
  id: string
  title: string
  method: string
  severity: number
  probability: number
  detectability: number | null
  score: number
  riskLevel: string
  mitigationActions: string | null
  capaId: string | null
  sourceRecordType: string | null
  sourceRecordId: string | null
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
}

export interface RiskRegisterLookups {
  /** `${type}:${id}` -> readable reference (e.g. a deviation number). */
  sourceRefs: Map<string, string>
  /** user id -> full name. */
  userNames: Map<string, string>
  /** capa id -> title and status. */
  capas: Map<string, { title: string; status: string }>
}

export function resolveSourceReference(
  type: string | null,
  id: string | null,
  lookups: RiskRegisterLookups,
): string {
  if (!type || !id) return ''
  const found = lookups.sourceRefs.get(`${type}:${id}`)
  if (found) return found
  return `${SOURCE_TYPE_LABELS[type] ?? type} ${id}`
}

function iso(d: Date): string {
  return d.toISOString()
}

export function buildRiskRegisterRows(
  risks: RiskRegisterSourceInput[],
  lookups: RiskRegisterLookups,
): (string | number)[][] {
  return risks.map((r) => {
    const capa = r.capaId ? lookups.capas.get(r.capaId) : undefined
    return [
      r.title,
      RISK_METHOD_LABELS[r.method] ?? r.method,
      r.severity,
      r.probability,
      r.detectability ?? '',
      r.score,
      r.riskLevel,
      r.mitigationActions ?? '',
      capa ? `${capa.title} (${capa.status})` : '',
      r.sourceRecordType ? (SOURCE_TYPE_LABELS[r.sourceRecordType] ?? r.sourceRecordType) : '',
      resolveSourceReference(r.sourceRecordType, r.sourceRecordId, lookups),
      r.createdBy ? (lookups.userNames.get(r.createdBy) ?? '') : '',
      iso(r.createdAt),
      iso(r.updatedAt),
    ]
  })
}

function csvCell(value: string | number): string {
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toRiskRegisterCsv(rows: (string | number)[][]): string {
  const header = RISK_REGISTER_COLUMNS.map(csvCell).join(',')
  const body = rows.map((row) => row.map(csvCell).join(','))
  return [header, ...body].join('\r\n') + '\r\n'
}

export async function toRiskRegisterXlsx(rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'SafeMeds'
  const sheet = workbook.addWorksheet('Risk register')
  sheet.columns = RISK_REGISTER_COLUMNS.map((label) => ({ header: label, key: label, width: 22 }))
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  for (const row of rows) sheet.addRow(row)
  const out = await workbook.xlsx.writeBuffer()
  return Buffer.from(out)
}
