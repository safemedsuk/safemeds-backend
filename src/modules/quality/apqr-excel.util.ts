import ExcelJS from 'exceljs'

import { ApqrDocumentModel } from './apqr-document'

/**
 * Phase 2 Pass C — the APQR as an Excel workbook. Same model as the PDF:
 * a Summary sheet (header, counts, conclusions, actions, signature) and one
 * sheet per section. Sheet names are capped at Excel's 31 characters.
 */
export async function toApqrXlsx(model: ApqrDocumentModel): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'SafeMeds'
  workbook.created = new Date(model.header.generatedAt)

  const h = model.header
  const summary = workbook.addWorksheet('Summary')
  summary.columns = [
    { header: 'Field', key: 'field', width: 36 },
    { header: 'Value', key: 'value', width: 90 },
  ]
  summary.getRow(1).font = { bold: true }
  const rows: [string, string][] = [
    ['Document', 'Annual Product Quality Review'],
    ['Company', h.companyName],
    ['Product', h.productName],
    ['Period start', h.periodStart.slice(0, 10)],
    ['Period end', h.periodEnd.slice(0, 10)],
    ['Period note', h.periodNote],
    ['Generated (UTC)', h.generatedAt],
    ['Reviewed and signed by', h.reviewedByFullName ?? 'Not yet signed'],
    ['Reviewed at (UTC)', h.reviewedAt ?? ''],
    ['Conclusions', h.conclusionsNarrative ?? ''],
    ['Trends', h.trendsNarrative ?? ''],
    [
      'Recommended actions',
      h.recommendedActions
        .map((a, i) => `${i + 1}. ${a.description}${a.capaOpened ? ' (CAPA opened)' : ''}`)
        .join('\n'),
    ],
    ['Stability', h.stabilityNote],
    ['Open quality trend flags', h.openQualityTrendFlags.join('; ')],
    ...model.summary.map((s): [string, string] => [s.label, s.value]),
  ]
  for (const [field, value] of rows) summary.addRow([field, value])
  summary.eachRow((row, n) => {
    if (n > 1) row.alignment = { wrapText: true, vertical: 'top' }
  })

  for (const table of model.tables) {
    const name = table.title.slice(0, 31)
    const sheet = workbook.addWorksheet(name)
    sheet.columns = table.columns.map((c) => ({
      header: c.label,
      key: c.label,
      width: Math.max(12, Math.round(c.width / 6)),
    }))
    sheet.getRow(1).font = { bold: true }
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    if (table.rows.length === 0) {
      sheet.addRow([table.emptyText])
    } else {
      for (const row of table.rows) sheet.addRow(row)
    }
  }

  const out = await workbook.xlsx.writeBuffer()
  return Buffer.from(out)
}
