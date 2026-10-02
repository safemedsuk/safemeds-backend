import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { InspectionReadinessService } from './inspection-readiness.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const render = jest.fn().mockResolvedValue(Buffer.from('pdf'))
  const pdfService = { render } as never

  const uploadDirect = jest.fn().mockResolvedValue({ document: { id: 'doc-1' } })
  const documentsService = { uploadDirect } as never

  const companyFindUniqueOrThrow = jest.fn().mockResolvedValue({
    name: 'Test Co',
    homeCountryId: 'ke',
    homeCountry: { name: 'Kenya' },
  })
  const templateFindMany = jest.fn().mockResolvedValue([])
  const authorityCount = jest.fn().mockResolvedValue(1)
  const facilityCount = jest.fn().mockResolvedValue(1)
  const equipmentCount = jest.fn().mockResolvedValue(0)
  const deviationCount = jest.fn().mockResolvedValue(0)
  const trainingRecordFindMany = jest.fn().mockResolvedValue([])
  const sopCount = jest.fn().mockResolvedValue(0)
  const oosCount = jest.fn().mockResolvedValue(0)
  const batchCount = jest.fn().mockResolvedValue(0)
  const packCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const packFindMany = jest.fn().mockResolvedValue([])
  const packFindFirst = jest.fn()

  const tables = {
    company: { findUniqueOrThrow: companyFindUniqueOrThrow },
    inspectionChecklistTemplate: { findMany: templateFindMany },
    regulatoryAuthority: { count: authorityCount },
    facility: { count: facilityCount },
    equipment: { count: equipmentCount },
    deviation: { count: deviationCount },
    trainingRecord: { findMany: trainingRecordFindMany },
    sop: { count: sopCount },
    oos: { count: oosCount },
    batch: { count: batchCount },
    inspectionReadinessPack: { create: packCreate, findMany: packFindMany, findFirst: packFindFirst },
  }
  const rls = { runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables) }

  const service = new InspectionReadinessService(rls as never, auditService, pdfService, documentsService)
  return {
    service,
    auditLog,
    render,
    uploadDirect,
    templateFindMany,
    facilityCount,
    equipmentCount,
    deviationCount,
    trainingRecordFindMany,
    sopCount,
    oosCount,
    batchCount,
    packCreate,
    authorityCount,
  }
}

function template(overrides: Record<string, unknown> = {}) {
  return {
    sectionKey: 'facility_status',
    title: 'Premises',
    description: 'desc',
    mappedRecordType: 'facility_status',
    sortOrder: 1,
    guidelineReference: null,
    unverified: true,
    ...overrides,
  }
}

describe('InspectionReadinessService.getSnapshot', () => {
  it('reports overall ready when every mapped section resolves ready', async () => {
    const { service, templateFindMany, facilityCount } = buildHarness()
    templateFindMany.mockResolvedValue([template()])
    facilityCount.mockResolvedValue(1)

    const result = await service.getSnapshot(actor)
    expect(result.overall).toBe('ready')
    expect(result.rows[0]).toMatchObject({ sectionKey: 'facility_status', status: 'ready' })
  })

  it('reports needs_attention when any mapped section is not ready', async () => {
    const { service, templateFindMany, facilityCount } = buildHarness()
    templateFindMany.mockResolvedValue([template()])
    facilityCount.mockResolvedValue(0)

    const result = await service.getSnapshot(actor)
    expect(result.overall).toBe('needs_attention')
    expect(result.rows[0].note).toMatch(/no active facility/i)
  })

  it('honestly reports "no live resolver" for a section with an unrecognized mappedRecordType, rather than fabricating readiness', async () => {
    const { service, templateFindMany } = buildHarness()
    templateFindMany.mockResolvedValue([template({ mappedRecordType: 'something_unmapped' })])

    const result = await service.getSnapshot(actor)
    expect(result.rows[0].status).toBe('needs_attention')
    expect(result.rows[0].note).toMatch(/no live resolver/i)
  })

  it('flags open critical deviations as needs_attention with a real count', async () => {
    const { service, templateFindMany, deviationCount } = buildHarness()
    templateFindMany.mockResolvedValue([template({ sectionKey: 'processes', mappedRecordType: 'open_critical_deviations' })])
    deviationCount.mockResolvedValue(2)

    const result = await service.getSnapshot(actor)
    expect(result.rows[0]).toMatchObject({ status: 'needs_attention' })
    expect(result.rows[0].note).toContain('2')
  })

  it('surfaces authorityConfigured honestly for an unconfigured market', async () => {
    const { service, authorityCount } = buildHarness()
    authorityCount.mockResolvedValue(0)

    const result = await service.getSnapshot(actor)
    expect(result.authorityConfigured).toBe(false)
  })
})

describe('InspectionReadinessService.generatePack', () => {
  it('renders a PDF, uploads it, and creates a real InspectionReadinessPack row', async () => {
    const { service, render, uploadDirect, packCreate } = buildHarness()

    const result = await service.generatePack(actor, {})

    expect(render).toHaveBeenCalled()
    expect(uploadDirect).toHaveBeenCalled()
    expect(packCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pdfDocumentId: 'doc-1', generatedBy: 'user-1' }),
      }),
    )
    expect(result.pdfDocumentId).toBe('doc-1')
  })
})
