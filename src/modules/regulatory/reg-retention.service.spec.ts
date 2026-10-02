import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegRetentionService } from './reg-retention.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

const activeRegistrationRow = {
  id: 'reg-1',
  registrationNumber: 'PPB-2026-0142',
  status: 'active',
  expiresOn: new Date('2099-01-01'),
  product: { brandName: 'Amoxiclav' },
  authority: { name: 'PPB' },
}

const invoiceFile = { buffer: Buffer.from(''), originalname: 'invoice.pdf', mimetype: 'application/pdf' }
const proofFile = { buffer: Buffer.from(''), originalname: 'proof.pdf', mimetype: 'application/pdf' }

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const uploadDirect = jest
    .fn()
    .mockImplementation((_actor, _recordType, _recordId, file: { originalname: string }) =>
      Promise.resolve({ document: { id: `doc-${file.originalname}` } }),
    )
  const documentsService = { uploadDirect } as never

  const render = jest.fn().mockResolvedValue(Buffer.from('%PDF fake'))
  const pdfService = { render } as never

  const productRegistrationFindFirst = jest.fn().mockResolvedValue(activeRegistrationRow)
  const regRetentionFindFirst = jest.fn().mockResolvedValue(null)
  const regRetentionFindMany = jest.fn().mockResolvedValue([])
  const regRetentionCount = jest.fn().mockResolvedValue(0)
  const regRetentionCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const companyFindUniqueOrThrow = jest.fn().mockResolvedValue({ name: 'RegCloud Test Co' })
  const userFindFirstOrThrow = jest.fn().mockResolvedValue({ fullName: 'Jane RA Officer' })

  const tables = {
    productRegistration: { findFirst: productRegistrationFindFirst },
    regRetention: {
      findFirst: regRetentionFindFirst,
      findMany: regRetentionFindMany,
      count: regRetentionCount,
      create: regRetentionCreate,
    },
    company: { findUniqueOrThrow: companyFindUniqueOrThrow },
    user: { findFirstOrThrow: userFindFirstOrThrow },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new RegRetentionService(rls as never, auditService, documentsService, pdfService)
  return {
    service,
    auditLog,
    uploadDirect,
    render,
    productRegistrationFindFirst,
    regRetentionFindFirst,
    regRetentionFindMany,
    regRetentionCount,
    regRetentionCreate,
  }
}

const baseDto = { productRegistrationId: 'reg-1', year: 2026, paidAt: '2026-11-15' }

describe('RegRetentionService.create', () => {
  it('404s when the registration does not exist', async () => {
    const { service, productRegistrationFindFirst } = buildHarness()
    productRegistrationFindFirst.mockResolvedValue(null)

    await expect(service.create(actor, baseDto, invoiceFile, proofFile, {})).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  it('rejects retention on a withdrawn registration', async () => {
    const { service, productRegistrationFindFirst } = buildHarness()
    productRegistrationFindFirst.mockResolvedValue({ ...activeRegistrationRow, status: 'withdrawn' })

    await expect(service.create(actor, baseDto, invoiceFile, proofFile, {})).rejects.toMatchObject({
      response: { code: 'REGISTRATION_WITHDRAWN' },
    })
  })

  it('rejects retention on an expired registration', async () => {
    const { service, productRegistrationFindFirst } = buildHarness()
    productRegistrationFindFirst.mockResolvedValue({
      ...activeRegistrationRow,
      expiresOn: new Date('2020-01-01'),
    })

    await expect(service.create(actor, baseDto, invoiceFile, proofFile, {})).rejects.toMatchObject({
      response: { code: 'REGISTRATION_EXPIRED' },
    })
  })

  it('rejects a second retention for the same (registration, year)', async () => {
    const { service, regRetentionFindFirst } = buildHarness()
    regRetentionFindFirst.mockResolvedValue({ id: 'existing-retention' })

    await expect(service.create(actor, baseDto, invoiceFile, proofFile, {})).rejects.toMatchObject({
      response: { code: 'RETENTION_ALREADY_EXISTS_FOR_YEAR' },
    })
  })

  it('uploads both documents, generates a real certificate, and creates a certified RegRetention row with a real RET- display code', async () => {
    const { service, uploadDirect, render, regRetentionCreate, regRetentionCount } = buildHarness()
    regRetentionCount.mockResolvedValue(3)

    const result = await service.create(actor, baseDto, invoiceFile, proofFile, {})

    expect(uploadDirect).toHaveBeenCalledWith(
      actor,
      'reg_retention',
      expect.any(String),
      invoiceFile,
      { title: 'Retention Invoice' },
      {},
    )
    expect(uploadDirect).toHaveBeenCalledWith(
      actor,
      'reg_retention',
      expect.any(String),
      proofFile,
      { title: 'Proof of Payment' },
      {},
    )
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: 'RegCloud Test Co',
        productBrandName: 'Amoxiclav',
        registrationNumber: 'PPB-2026-0142',
        authorityName: 'PPB',
        year: 2026,
        displayCode: 'RET-00004-PPB-2026-0142',
        createdByName: 'Jane RA Officer',
      }),
    )
    expect(regRetentionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productRegistrationId: 'reg-1',
          displayCode: 'RET-00004-PPB-2026-0142',
          year: 2026,
          invoiceDocumentId: 'doc-invoice.pdf',
          proofOfPaymentDocumentId: 'doc-proof.pdf',
          certificateDocumentId: expect.stringMatching(/^doc-retention-certificate-/),
          status: 'certified',
        }),
      }),
    )
    expect(result.status).toBe('certified')
  })
})

describe('RegRetentionService.list/listAllForCompany/get', () => {
  it('list() scopes by productRegistrationId', async () => {
    const { service, regRetentionFindMany } = buildHarness()
    await service.list(actor, 'reg-1')
    expect(regRetentionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'company-1', productRegistrationId: 'reg-1' } }),
    )
  })

  it('listAllForCompany() scopes by companyId alone', async () => {
    const { service, regRetentionFindMany } = buildHarness()
    await service.listAllForCompany(actor)
    expect(regRetentionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'company-1' } }),
    )
  })

  it('get() 404s when the retention does not exist', async () => {
    const { service, regRetentionFindFirst } = buildHarness()
    regRetentionFindFirst.mockResolvedValue(null)
    await expect(service.get(actor, 'ret-1')).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })
})
