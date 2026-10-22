import ExcelJS from 'exceljs'

import {
  buildRiskRegisterRows,
  resolveSourceReference,
  RISK_REGISTER_COLUMNS,
  RiskRegisterLookups,
  RiskRegisterSourceInput,
  toRiskRegisterCsv,
  toRiskRegisterXlsx,
} from './risk-register-export.util'

const lookups: RiskRegisterLookups = {
  sourceRefs: new Map([['deviation:d1', 'DEV-2026-0007']]),
  userNames: new Map([['u1', 'Ann Quality']]),
  capas: new Map([['c1', { title: 'Replace seal', status: 'open' }]]),
}

const base: RiskRegisterSourceInput = {
  id: 'r1',
  title: 'Seal failure, "blister" line',
  method: 'fmea',
  severity: 4,
  probability: 3,
  detectability: 2,
  score: 24,
  riskLevel: 'high',
  mitigationActions: 'Add\nin-line check',
  capaId: 'c1',
  sourceRecordType: 'deviation',
  sourceRecordId: 'd1',
  createdBy: 'u1',
  createdAt: new Date('2026-10-01T08:00:00Z'),
  updatedAt: new Date('2026-10-02T09:30:00Z'),
}

describe('risk register export', () => {
  it('resolves a source record to its readable reference and falls back to type + id', () => {
    expect(resolveSourceReference('deviation', 'd1', lookups)).toBe('DEV-2026-0007')
    expect(resolveSourceReference('batch', 'b9', lookups)).toBe('Batch b9')
    expect(resolveSourceReference(null, null, lookups)).toBe('')
  })

  it('builds one row per risk with the agreed column contract', () => {
    const rows = buildRiskRegisterRows(
      [
        base,
        {
          ...base,
          id: 'r2',
          sourceRecordType: null,
          sourceRecordId: null,
          capaId: null,
          detectability: null,
          createdBy: null,
        },
      ],
      lookups,
    )
    expect(rows[0]).toHaveLength(RISK_REGISTER_COLUMNS.length)
    expect(rows[0]).toEqual([
      'Seal failure, "blister" line',
      'FMEA',
      4,
      3,
      2,
      24,
      'high',
      'Add\nin-line check',
      'Replace seal (open)',
      'Deviation',
      'DEV-2026-0007',
      'Ann Quality',
      '2026-10-01T08:00:00.000Z',
      '2026-10-02T09:30:00.000Z',
    ])
    expect(rows[1][8]).toBe('')
    expect(rows[1][10]).toBe('')
    expect(rows[1][11]).toBe('')
    expect(rows[1][4]).toBe('')
  })

  it('CSV quotes commas, quotes and newlines, and writes the header first', () => {
    const csv = toRiskRegisterCsv(buildRiskRegisterRows([base], lookups))
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(RISK_REGISTER_COLUMNS.join(','))
    expect(csv).toContain('"Seal failure, ""blister"" line"')
    expect(csv).toContain('"Add\nin-line check"')
  })

  it('Excel workbook round-trips: header row, data row and values read back with exceljs', async () => {
    const buffer = await toRiskRegisterXlsx(buildRiskRegisterRows([base], lookups))
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as ArrayBuffer)
    const sheet = wb.getWorksheet('Risk register')!
    expect(sheet.getRow(1).getCell(1).value).toBe('Title')
    expect(sheet.getRow(2).getCell(6).value).toBe(24)
    expect(sheet.getRow(2).getCell(11).value).toBe('DEV-2026-0007')
    expect(sheet.rowCount).toBe(2)
  })
})
