import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegPostMarketObligationService } from './reg-post-market-obligation.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

const registrationRow = {
  id: 'reg-1',
  authorityId: 'authority-1',
  productClass: 'generic_pharma',
  issuedOn: new Date('2026-03-01'),
  productId: 'product-1',
  registrationNumber: 'PPB-2026-0001',
  companyId: 'company-1',
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const resolveDeadlineRule = jest.fn().mockResolvedValue(null)
  const listActiveDeadlineRulesByObligationType = jest.fn().mockResolvedValue([])
  const regConfigService = { resolveDeadlineRule, listActiveDeadlineRulesByObligationType } as never

  const uploadDirect = jest.fn().mockResolvedValue({ document: { id: 'doc-1' } })
  const documentsService = { uploadDirect } as never

  const pdfRender = jest.fn().mockResolvedValue(Buffer.from('pdf'))
  const pdfService = { render: pdfRender } as never

  const escalateForRecord = jest.fn().mockResolvedValue(undefined)
  const tasksService = { escalateForRecord } as never
  const notificationCreate = jest.fn().mockResolvedValue(undefined)
  const notificationsService = { create: notificationCreate } as never

  const registrationFindFirst = jest.fn().mockResolvedValue(registrationRow)
  const registrationFindMany = jest.fn().mockResolvedValue([])
  const obligationFindUnique = jest.fn().mockResolvedValue(null)
  const obligationFindFirst = jest
    .fn()
    .mockResolvedValue({
      id: 'obligation-1',
      companyId: 'company-1',
      obligationType: 'annual_report',
      productRegistration: registrationRow,
    })
  const obligationFindMany = jest.fn().mockResolvedValue([])
  const obligationCount = jest.fn().mockResolvedValue(0)
  const obligationCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const obligationUpdate = jest
    .fn()
    .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))
  const fulfillmentCreate = jest.fn().mockResolvedValue(undefined)
  const fulfillmentFindFirst = jest.fn().mockResolvedValue(null)
  const authorityFindUnique = jest
    .fn()
    .mockResolvedValue({ id: 'authority-1', countryId: 'ke', name: 'Pharmacy and Poisons Board' })
  const authorityFindUniqueOrThrow = jest
    .fn()
    .mockResolvedValue({ id: 'authority-1', countryId: 'ke', name: 'Pharmacy and Poisons Board' })
  const companyFindUniqueOrThrow = jest
    .fn()
    .mockResolvedValue({ id: 'company-1', name: 'Acme Pharma' })
  const productFindUniqueOrThrow = jest
    .fn()
    .mockResolvedValue({ id: 'product-1', brandName: 'Amoxiclav' })
  const userFindUniqueOrThrow = jest
    .fn()
    .mockResolvedValue({ id: 'user-1', fullName: 'Jane Officer' })
  const userFindMany = jest.fn().mockResolvedValue([])
  const generatedReportCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))

  const tables = {
    productRegistration: { findFirst: registrationFindFirst, findMany: registrationFindMany },
    regPostMarketObligation: {
      findUnique: obligationFindUnique,
      findFirst: obligationFindFirst,
      findMany: obligationFindMany,
      count: obligationCount,
      create: obligationCreate,
      update: obligationUpdate,
    },
    regPostMarketObligationFulfillment: {
      create: fulfillmentCreate,
      findFirst: fulfillmentFindFirst,
    },
    regulatoryAuthority: {
      findUnique: authorityFindUnique,
      findUniqueOrThrow: authorityFindUniqueOrThrow,
    },
    company: { findUniqueOrThrow: companyFindUniqueOrThrow },
    product: { findUniqueOrThrow: productFindUniqueOrThrow },
    user: { findUniqueOrThrow: userFindUniqueOrThrow, findMany: userFindMany },
    generatedReport: { create: generatedReportCreate },
  }

  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new RegPostMarketObligationService(
    rls as never,
    auditService,
    regConfigService,
    documentsService,
    pdfService,
    tasksService,
    notificationsService,
  )

  return {
    service,
    auditLog,
    resolveDeadlineRule,
    listActiveDeadlineRulesByObligationType,
    uploadDirect,
    pdfRender,
    escalateForRecord,
    notificationCreate,
    registrationFindFirst,
    registrationFindMany,
    obligationFindUnique,
    obligationFindFirst,
    obligationFindMany,
    obligationCreate,
    obligationUpdate,
    fulfillmentCreate,
    userFindMany,
    generatedReportCreate,
    authorityFindUnique,
  }
}

describe('RegPostMarketObligationService.create', () => {
  it('computes dueAt from an active rule when one resolves', async () => {
    const { service, resolveDeadlineRule, obligationCreate } = buildHarness()
    resolveDeadlineRule.mockResolvedValue({ id: 'rule-1', intervalValue: 1, intervalUnit: 'years' })

    await service.create(
      actor,
      { productRegistrationId: 'reg-1', obligationType: 'annual_report' },
      {},
    )

    expect(obligationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          obligationType: 'annual_report',
          dueAt: new Date('2027-03-01'),
          status: 'pending',
        }),
      }),
    )
  })

  it('accepts an explicit dueAt when no rule resolves', async () => {
    const { service, obligationCreate } = buildHarness()

    await service.create(
      actor,
      {
        productRegistrationId: 'reg-1',
        obligationType: 'periodic_safety_update',
        dueAt: '2027-06-01',
      },
      {},
    )

    expect(obligationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dueAt: new Date('2027-06-01') }) }),
    )
  })

  it('rejects with DUE_DATE_REQUIRED when no rule resolves and no explicit date is given', async () => {
    const { service } = buildHarness()

    await expect(
      service.create(
        actor,
        { productRegistrationId: 'reg-1', obligationType: 'periodic_safety_update' },
        {},
      ),
    ).rejects.toMatchObject({
      response: { code: 'DUE_DATE_REQUIRED' },
    })
  })

  it('rejects with ALREADY_TRACKED when this registration already tracks this obligation type', async () => {
    const { service, obligationFindUnique } = buildHarness()
    obligationFindUnique.mockResolvedValue({ id: 'existing-1' })

    await expect(
      service.create(
        actor,
        { productRegistrationId: 'reg-1', obligationType: 'annual_report', dueAt: '2027-01-01' },
        {},
      ),
    ).rejects.toMatchObject({
      response: { code: 'ALREADY_TRACKED' },
    })
  })

  it('404s when the registration does not resolve (cross-tenant, invisible under RLS)', async () => {
    const { service, registrationFindFirst } = buildHarness()
    registrationFindFirst.mockResolvedValue(null)

    await expect(
      service.create(
        actor,
        {
          productRegistrationId: 'other-co-reg',
          obligationType: 'annual_report',
          dueAt: '2027-01-01',
        },
        {},
      ),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })
})

describe('RegPostMarketObligationService.fulfill', () => {
  it('rolls the same row forward to the next cycle when a rule still resolves', async () => {
    const { service, resolveDeadlineRule, obligationUpdate, fulfillmentCreate } = buildHarness()
    resolveDeadlineRule.mockResolvedValue({ id: 'rule-1', intervalValue: 1, intervalUnit: 'years' })

    await service.fulfill(actor, 'obligation-1', { note: 'Filed with PPB directly.' }, {})

    expect(fulfillmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          obligationId: 'obligation-1',
          note: 'Filed with PPB directly.',
        }),
      }),
    )
    expect(obligationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'obligation-1' },
        data: expect.objectContaining({ status: 'pending', notifiedOverdueAt: null }),
      }),
    )
  })

  it('leaves the obligation fulfilled with no next cycle when no rule resolves', async () => {
    const { service, obligationUpdate } = buildHarness()

    await service.fulfill(actor, 'obligation-1', {}, {})

    expect(obligationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'obligation-1' }, data: { status: 'fulfilled' } }),
    )
  })

  it('records the evidence document id on the fulfillment row', async () => {
    const { service, fulfillmentCreate } = buildHarness()

    await service.fulfill(actor, 'obligation-1', { evidenceDocumentId: 'doc-99' }, {})

    expect(fulfillmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ evidenceDocumentId: 'doc-99' }) }),
    )
  })

  it('generates a real filing-record PDF and stores it as a GeneratedReport when requested', async () => {
    const { service, pdfRender, uploadDirect, generatedReportCreate, fulfillmentCreate } =
      buildHarness()

    await service.fulfill(
      actor,
      'obligation-1',
      { generateFilingRecord: true, note: 'Annual report filed.' },
      {},
    )

    expect(pdfRender).toHaveBeenCalledWith(
      expect.objectContaining({
        registrationNumber: 'PPB-2026-0001',
        obligationType: 'annual_report',
      }),
    )
    expect(uploadDirect).toHaveBeenCalled()
    expect(generatedReportCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ moduleKey: 'regcloud', recordId: 'obligation-1' }),
      }),
    )
    expect(fulfillmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ generatedReportId: expect.any(String) }),
      }),
    )
  })

  it('404s when the obligation does not resolve (cross-tenant, invisible under RLS)', async () => {
    const { service, obligationFindFirst } = buildHarness()
    obligationFindFirst.mockResolvedValue(null)

    await expect(service.fulfill(actor, 'other-co-obligation', {}, {})).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })
})

describe('RegPostMarketObligationService.ensureObligationsForRegistration', () => {
  it('creates a new obligation for every active, non-reserved rule not already tracked', async () => {
    const { service, listActiveDeadlineRulesByObligationType, obligationCreate } = buildHarness()
    listActiveDeadlineRulesByObligationType.mockResolvedValue([
      { obligationType: 'annual_report', intervalValue: 1, intervalUnit: 'years' },
      { obligationType: 'renewal', intervalValue: 5, intervalUnit: 'years' },
    ])

    await service.ensureObligationsForRegistration('company-1', registrationRow as never, 'user-1')

    expect(obligationCreate).toHaveBeenCalledTimes(1)
    expect(obligationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ obligationType: 'annual_report' }),
      }),
    )
  })

  it('is idempotent — never re-creates an obligation that already exists', async () => {
    const {
      service,
      listActiveDeadlineRulesByObligationType,
      obligationFindUnique,
      obligationCreate,
    } = buildHarness()
    listActiveDeadlineRulesByObligationType.mockResolvedValue([
      { obligationType: 'annual_report', intervalValue: 1, intervalUnit: 'years' },
    ])
    obligationFindUnique.mockResolvedValue({ id: 'already-exists' })

    await service.ensureObligationsForRegistration('company-1', registrationRow as never, 'user-1')

    expect(obligationCreate).not.toHaveBeenCalled()
  })

  it('does nothing when the registration authority does not resolve', async () => {
    const { service, authorityFindUnique, obligationCreate } = buildHarness()
    authorityFindUnique.mockResolvedValue(null)

    await service.ensureObligationsForRegistration('company-1', registrationRow as never, 'user-1')

    expect(obligationCreate).not.toHaveBeenCalled()
  })
})

describe('RegPostMarketObligationService.scanAndFlagOverdue', () => {
  it('flips a pending, past-due obligation to overdue and escalates', async () => {
    const {
      service,
      obligationFindMany,
      obligationUpdate,
      escalateForRecord,
      notificationCreate,
      userFindMany,
    } = buildHarness()
    obligationFindMany.mockResolvedValue([
      {
        id: 'obligation-1',
        companyId: 'company-1',
        obligationType: 'annual_report',
        dueAt: new Date('2020-01-01'),
        productRegistration: registrationRow,
      },
    ])
    userFindMany.mockResolvedValue([{ id: 'user-2', email: 'ra@example.com' }])

    const result = await service.scanAndFlagOverdue()

    expect(result).toEqual({ flagged: 1 })
    expect(obligationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'obligation-1' },
        data: expect.objectContaining({ status: 'overdue' }),
      }),
    )
    expect(escalateForRecord).toHaveBeenCalledWith(
      'company-1',
      'reg_post_market_obligation',
      'obligation-1',
      'overdue',
      expect.any(String),
      {},
    )
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-2', category: 'deadline_breached' }),
    )
  })

  it('reports zero flagged when nothing is overdue', async () => {
    const { service } = buildHarness()
    const result = await service.scanAndFlagOverdue()
    expect(result).toEqual({ flagged: 0 })
  })
})
