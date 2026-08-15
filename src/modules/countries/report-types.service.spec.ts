import { ReportTypesService } from './report-types.service'

interface ReportTypeRow {
  id: string
  typeKey: string
  name: string
  moduleKey: string
}

function buildHarness(rows: ReportTypeRow[]) {
  const findMany = jest.fn().mockImplementation(({ where }: { where?: { moduleKey?: string } }) => {
    const filtered = where?.moduleKey ? rows.filter((r) => r.moduleKey === where.moduleKey) : rows
    return Promise.resolve([...filtered].sort((a, b) => a.name.localeCompare(b.name)))
  })
  const prisma = { reportType: { findMany } }
  const service = new ReportTypesService(prisma as never)
  return { service, findMany }
}

const SEED: ReportTypeRow[] = [
  { id: '1', typeKey: 'adr', name: 'Suspected Adverse Drug Reaction', moduleKey: 'pv' },
  { id: '2', typeKey: 'device_incident', name: 'Medical Device / IVD Incident', moduleKey: 'pv' },
  { id: '3', typeKey: 'deviation', name: 'Quality Deviation', moduleKey: 'qualcloud' },
]

describe('ReportTypesService.list()', () => {
  it('returns every report type when no moduleKey filter is given', async () => {
    const { service } = buildHarness(SEED)
    const result = await service.list()
    expect(result).toHaveLength(3)
  })

  it('filters to exactly the requested module', async () => {
    const { service } = buildHarness(SEED)
    const result = await service.list('pv')
    expect(result).toHaveLength(2)
    expect(result.every((r) => r.moduleKey === 'pv')).toBe(true)
  })

  it('returns an empty list for a module with no report types yet', async () => {
    const { service } = buildHarness(SEED)
    const result = await service.list('regcloud')
    expect(result).toEqual([])
  })
})
