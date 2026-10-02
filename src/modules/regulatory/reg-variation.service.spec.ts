import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegVariationService } from './reg-variation.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

const activeRegistrationRow = {
  id: 'reg-1',
  productId: 'product-1',
  authorityId: 'authority-1',
  productClass: 'generic_pharma',
  registrationNumber: 'PPB-2026-0142',
  status: 'active',
  expiresOn: new Date('2099-01-01'),
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const create = jest.fn().mockResolvedValue({ id: 'dossier-1', status: 'planning', documentSlots: [] })
  const regDossierService = { create } as never

  const uploadDirect = jest.fn().mockResolvedValue({ document: { id: 'doc-1' } })
  const documentsService = { uploadDirect } as never

  const productRegistrationFindFirst = jest.fn().mockResolvedValue(activeRegistrationRow)
  const regVariationCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const regVariationCount = jest.fn().mockResolvedValue(0)
  const regVariationFindFirst = jest.fn()
  const regVariationFindMany = jest.fn().mockResolvedValue([])
  const regVariationUpdate = jest
    .fn()
    .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))
  const workflowInstanceFindFirstOrThrow = jest
    .fn()
    .mockResolvedValue({ id: 'instance-1', definitionId: 'def-1' })
  const workflowInstanceUpdate = jest.fn().mockResolvedValue(undefined)
  const workflowStateFindFirstOrThrow = jest
    .fn()
    .mockImplementation(({ where }) => Promise.resolve({ id: `state-${where.stateKey}`, stateKey: where.stateKey }))
  const regDossierUpdate = jest.fn().mockResolvedValue(undefined)

  const tables = {
    productRegistration: { findFirst: productRegistrationFindFirst },
    regVariation: {
      create: regVariationCreate,
      count: regVariationCount,
      findFirst: regVariationFindFirst,
      findMany: regVariationFindMany,
      update: regVariationUpdate,
    },
    workflowInstance: {
      findFirstOrThrow: workflowInstanceFindFirstOrThrow,
      update: workflowInstanceUpdate,
    },
    workflowState: { findFirstOrThrow: workflowStateFindFirstOrThrow },
    regDossier: { update: regDossierUpdate },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new RegVariationService(rls as never, auditService, regDossierService, documentsService)
  return {
    service,
    auditLog,
    create,
    uploadDirect,
    productRegistrationFindFirst,
    regVariationCreate,
    regVariationCount,
    regVariationFindFirst,
    regVariationFindMany,
    regVariationUpdate,
    workflowInstanceFindFirstOrThrow,
    workflowInstanceUpdate,
    workflowStateFindFirstOrThrow,
    regDossierUpdate,
  }
}

describe('RegVariationService.create', () => {
  it('404s when the target registration does not exist', async () => {
    const { service, productRegistrationFindFirst } = buildHarness()
    productRegistrationFindFirst.mockResolvedValue(null)

    await expect(
      service.create(actor, { productRegistrationId: 'reg-1', variationType: 'renewal' }, {}),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })

  it('creates the dossier via RegDossierService.create(), pre-setting productRegistrationId, defaulting product/authority/class from the target registration', async () => {
    const { service, create } = buildHarness()

    await service.create(actor, { productRegistrationId: 'reg-1', variationType: 'renewal' }, {})

    expect(create).toHaveBeenCalledWith(
      actor,
      {
        productId: 'product-1',
        authorityId: 'authority-1',
        productClass: 'generic_pharma',
        route: undefined,
      },
      {},
      'reg-1',
    )
  })

  it('honors explicit overrides for product/authority/class/route instead of the registration defaults', async () => {
    const { service, create } = buildHarness()

    await service.create(
      actor,
      {
        productRegistrationId: 'reg-1',
        variationType: 'minor',
        productClass: 'new_class',
        route: 'oral',
      },
      {},
    )

    expect(create).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ productClass: 'new_class', route: 'oral' }),
      {},
      'reg-1',
    )
  })

  it('creates a real RegVariation row wrapping the new dossier, with status "open" and a real VAR- display code', async () => {
    const { service, regVariationCreate } = buildHarness()

    const result = await service.create(
      actor,
      { productRegistrationId: 'reg-1', variationType: 'minor' },
      {},
    )

    expect(regVariationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productRegistrationId: 'reg-1',
          variationType: 'minor',
          displayCode: 'VAR-00001-PPB-2026-0142',
          regDossierId: 'dossier-1',
          status: 'open',
        }),
      }),
    )
    expect(result.regDossier.id).toBe('dossier-1')
  })

  it('generates a REN- display code for a renewal, on its own independent sequence from VAR-', async () => {
    const { service, regVariationCreate, regVariationCount } = buildHarness()
    regVariationCount.mockResolvedValue(2)

    await service.create(actor, { productRegistrationId: 'reg-1', variationType: 'renewal' }, {})

    expect(regVariationCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ variationType: 'renewal' }),
      }),
    )
    expect(regVariationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ displayCode: 'REN-00003-PPB-2026-0142' }) }),
    )
  })

  it('fast-forwards a non-renewal variation past planning straight to variation_application', async () => {
    const { service, workflowStateFindFirstOrThrow, workflowInstanceUpdate, regDossierUpdate } = buildHarness()

    const result = await service.create(
      actor,
      { productRegistrationId: 'reg-1', variationType: 'major' },
      {},
    )

    expect(workflowStateFindFirstOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { definitionId: 'def-1', stateKey: 'variation_application' } }),
    )
    expect(workflowInstanceUpdate).toHaveBeenCalledWith({
      where: { id: 'instance-1' },
      data: { currentStateId: 'state-variation_application' },
    })
    expect(regDossierUpdate).toHaveBeenCalledWith({
      where: { id: 'dossier-1' },
      data: { status: 'variation_application' },
    })
    expect(result.regDossier.status).toBe('variation_application')
  })

  it('fast-forwards a renewal past planning straight to renewal_requested', async () => {
    const { service, workflowStateFindFirstOrThrow, regDossierUpdate } = buildHarness()

    const result = await service.create(
      actor,
      { productRegistrationId: 'reg-1', variationType: 'renewal' },
      {},
    )

    expect(workflowStateFindFirstOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { definitionId: 'def-1', stateKey: 'renewal_requested' } }),
    )
    expect(regDossierUpdate).toHaveBeenCalledWith({
      where: { id: 'dossier-1' },
      data: { status: 'renewal_requested' },
    })
    expect(result.regDossier.status).toBe('renewal_requested')
  })

  it('rejects a renewal against an already-expired registration', async () => {
    const { service, productRegistrationFindFirst, create } = buildHarness()
    productRegistrationFindFirst.mockResolvedValue({
      ...activeRegistrationRow,
      expiresOn: new Date('2020-01-01'),
    })

    await expect(
      service.create(actor, { productRegistrationId: 'reg-1', variationType: 'renewal' }, {}),
    ).rejects.toMatchObject({ response: { code: 'REGISTRATION_EXPIRED' } })
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects a renewal against a withdrawn registration', async () => {
    const { service, productRegistrationFindFirst, create } = buildHarness()
    productRegistrationFindFirst.mockResolvedValue({ ...activeRegistrationRow, status: 'withdrawn' })

    await expect(
      service.create(actor, { productRegistrationId: 'reg-1', variationType: 'renewal' }, {}),
    ).rejects.toMatchObject({ response: { code: 'REGISTRATION_WITHDRAWN' } })
    expect(create).not.toHaveBeenCalled()
  })

  it('does NOT block a non-renewal variation against an expired registration — the user only asked to block renewal/withdrawal/retention', async () => {
    const { service, productRegistrationFindFirst, create } = buildHarness()
    productRegistrationFindFirst.mockResolvedValue({
      ...activeRegistrationRow,
      expiresOn: new Date('2020-01-01'),
    })

    await service.create(actor, { productRegistrationId: 'reg-1', variationType: 'minor' }, {})
    expect(create).toHaveBeenCalled()
  })
})

describe('RegVariationService.list/get/listAllForCompany', () => {
  it('list() scopes by productRegistrationId', async () => {
    const { service, regVariationFindMany } = buildHarness()
    await service.list(actor, 'reg-1')
    expect(regVariationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'company-1', productRegistrationId: 'reg-1' },
      }),
    )
  })

  it('listAllForCompany() scopes by companyId alone, across every registration', async () => {
    const { service, regVariationFindMany } = buildHarness()
    await service.listAllForCompany(actor)
    expect(regVariationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'company-1' } }),
    )
  })

  it('get() 404s when the variation does not exist', async () => {
    const { service, regVariationFindFirst } = buildHarness()
    regVariationFindFirst.mockResolvedValue(null)
    await expect(service.get(actor, 'var-1')).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })
})

describe('RegVariationService.attachPaymentProof/attachInvoice', () => {
  it('attachPaymentProof() 404s when the variation does not exist', async () => {
    const { service, regVariationFindFirst } = buildHarness()
    regVariationFindFirst.mockResolvedValue(null)

    await expect(
      service.attachPaymentProof(actor, 'var-1', { buffer: Buffer.from(''), originalname: 'f.pdf', mimetype: 'application/pdf' }, {}),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })

  it('attachPaymentProof() uploads against (reg_variation, variationId) and stores paymentProofDocumentId', async () => {
    const { service, regVariationFindFirst, uploadDirect, regVariationUpdate } = buildHarness()
    regVariationFindFirst.mockResolvedValue({ id: 'var-1', regDossierId: 'dossier-1' })

    await service.attachPaymentProof(
      actor,
      'var-1',
      { buffer: Buffer.from(''), originalname: 'proof.pdf', mimetype: 'application/pdf' },
      {},
    )

    expect(uploadDirect).toHaveBeenCalledWith(
      actor,
      'reg_variation',
      'var-1',
      expect.objectContaining({ originalname: 'proof.pdf' }),
      { title: 'Proof of Payment' },
      {},
    )
    expect(regVariationUpdate).toHaveBeenCalledWith({
      where: { id: 'var-1' },
      data: { paymentProofDocumentId: 'doc-1' },
    })
  })

  it('attachInvoice() stores invoiceDocumentId, a distinct field from attachPaymentProof()', async () => {
    const { service, regVariationFindFirst, regVariationUpdate } = buildHarness()
    regVariationFindFirst.mockResolvedValue({ id: 'var-1', regDossierId: 'dossier-1' })

    await service.attachInvoice(
      actor,
      'var-1',
      { buffer: Buffer.from(''), originalname: 'invoice.pdf', mimetype: 'application/pdf' },
      {},
    )

    expect(regVariationUpdate).toHaveBeenCalledWith({
      where: { id: 'var-1' },
      data: { invoiceDocumentId: 'doc-1' },
    })
  })
})
