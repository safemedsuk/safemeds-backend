import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegulatoryInspectionResponseService } from './regulatory-inspection-response.service'

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

  const uploadDirect = jest.fn().mockResolvedValue({ document: { id: 'doc-1' } })
  const documentsService = { uploadDirect } as never

  const internalAuditFindFirst = jest.fn()
  const create = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const findMany = jest.fn().mockResolvedValue([])
  const findFirst = jest.fn()
  const update = jest.fn().mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))

  const tables = {
    internalAudit: { findFirst: internalAuditFindFirst },
    regulatoryInspectionResponse: { create, findMany, findFirst, update },
  }
  const rls = { runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables) }

  const service = new RegulatoryInspectionResponseService(rls as never, auditService, documentsService)
  return { service, auditLog, uploadDirect, internalAuditFindFirst, create, findFirst, update }
}

describe('RegulatoryInspectionResponseService.create', () => {
  it('404s when the audit does not exist', async () => {
    const { service, internalAuditFindFirst } = buildHarness()
    internalAuditFindFirst.mockResolvedValue(null)

    await expect(service.create(actor, 'ghost', {}, {})).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  it('refuses to open one against a non-regulatory-scope audit', async () => {
    const { service, internalAuditFindFirst } = buildHarness()
    internalAuditFindFirst.mockResolvedValue({ id: 'audit-1', auditScope: 'internal' })

    await expect(service.create(actor, 'audit-1', {}, {})).rejects.toMatchObject({
      response: { code: 'NOT_REGULATORY_SCOPE' },
    })
  })

  it('creates one against a real regulatory-scope audit', async () => {
    const { service, internalAuditFindFirst, create } = buildHarness()
    internalAuditFindFirst.mockResolvedValue({ id: 'audit-1', auditScope: 'regulatory' })

    await service.create(actor, 'audit-1', { responseDueDate: '2026-07-01' }, {})

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ auditId: 'audit-1', responseDueDate: new Date('2026-07-01') }),
      }),
    )
  })
})

describe('RegulatoryInspectionResponseService.submit', () => {
  it('404s submitting to a response that does not exist', async () => {
    const { service, findFirst } = buildHarness()
    findFirst.mockResolvedValue(null)

    await expect(service.submit(actor, 'ghost', 'text', null, {})).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  it('uploads the evidence file and stamps the submission', async () => {
    const { service, findFirst, update, uploadDirect } = buildHarness()
    findFirst.mockResolvedValue({ id: 'response-1', evidenceDocumentId: null })
    const file = { buffer: Buffer.from(''), originalname: 'evidence.pdf', mimetype: 'application/pdf' }

    await service.submit(actor, 'response-1', 'We corrected the labeling error.', file, {})

    expect(uploadDirect).toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith({
      where: { id: 'response-1' },
      data: {
        responseText: 'We corrected the labeling error.',
        evidenceDocumentId: 'doc-1',
        submittedAt: expect.any(Date),
        submittedBy: 'user-1',
      },
    })
  })

  it('submits with no file at all, keeping any prior evidence document', async () => {
    const { service, findFirst, update, uploadDirect } = buildHarness()
    findFirst.mockResolvedValue({ id: 'response-1', evidenceDocumentId: 'old-doc' })

    await service.submit(actor, 'response-1', 'Text only.', null, {})

    expect(uploadDirect).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith({
      where: { id: 'response-1' },
      data: {
        responseText: 'Text only.',
        evidenceDocumentId: 'old-doc',
        submittedAt: expect.any(Date),
        submittedBy: 'user-1',
      },
    })
  })
})
