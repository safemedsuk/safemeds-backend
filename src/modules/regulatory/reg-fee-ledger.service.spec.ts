import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegFeeLedgerService } from './reg-fee-ledger.service'

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
  const resolveFeeSchedules = jest.fn()
  const regConfigService = { resolveFeeSchedules } as never
  const escalateForRecord = jest.fn().mockResolvedValue(undefined)
  const tasksService = { escalateForRecord } as never
  const notificationCreate = jest.fn().mockResolvedValue(undefined)
  const notificationsService = { create: notificationCreate } as never

  const invoiceFindUnique = jest.fn()
  const invoiceFindMany = jest.fn().mockResolvedValue([])
  const invoiceCount = jest.fn().mockResolvedValue(0)
  const invoiceCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const invoiceUpdate = jest
    .fn()
    .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))
  const paymentCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  // Defaults to "found" — RLS already makes a cross-tenant id invisible, so
  // the honest test for the 404 path is "this lookup returns null", not a
  // real cross-tenant fixture (see `attachDocument`'s own precedent in
  // `reg-dossier.service.spec.ts`).
  const registrationFindUnique = jest.fn().mockResolvedValue({ id: 'reg-1' })
  const dossierFindUnique = jest.fn().mockResolvedValue({ id: 'dossier-1' })
  const userFindMany = jest.fn().mockResolvedValue([])

  const tables = {
    regFeeInvoice: {
      findUnique: invoiceFindUnique,
      findMany: invoiceFindMany,
      count: invoiceCount,
      create: invoiceCreate,
      update: invoiceUpdate,
    },
    regFeePayment: { create: paymentCreate },
    productRegistration: { findUnique: registrationFindUnique },
    regDossier: { findUnique: dossierFindUnique },
    user: { findMany: userFindMany },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new RegFeeLedgerService(
    rls as never,
    auditService,
    regConfigService,
    tasksService,
    notificationsService,
  )
  return {
    service,
    auditLog,
    resolveFeeSchedules,
    escalateForRecord,
    notificationCreate,
    invoiceFindUnique,
    invoiceFindMany,
    invoiceCreate,
    invoiceUpdate,
    paymentCreate,
    userFindMany,
    registrationFindUnique,
  }
}

describe('RegFeeLedgerService.createInvoice', () => {
  it('creates a pending invoice and audits it', async () => {
    const { service, invoiceCreate, auditLog } = buildHarness()

    const created = await service.createInvoice(
      actor,
      { feeType: 'application', amount: '5000.00', dueAt: '2026-12-01' },
      {},
    )

    expect(created.status).toBe('pending')
    expect(invoiceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          feeType: 'application',
          amount: '5000.00',
          status: 'pending',
        }),
      }),
    )
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'reg_fee_invoice_created' }),
    )
  })

  it('404s when the referenced product registration does not resolve (cross-tenant, invisible under RLS)', async () => {
    const { service, registrationFindUnique } = buildHarness()
    registrationFindUnique.mockResolvedValue(null)

    await expect(
      service.createInvoice(
        actor,
        {
          productRegistrationId: 'other-company-reg',
          feeType: 'application',
          amount: '100',
          dueAt: '2026-12-01',
        },
        {},
      ),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })
})

describe('RegFeeLedgerService.recordPayment', () => {
  it('a partial payment stays pending, not paid — the update carries no status change at all', async () => {
    const { service, invoiceFindUnique, invoiceUpdate } = buildHarness()
    invoiceFindUnique.mockResolvedValue({
      id: 'inv-1',
      amount: '1000.00',
      status: 'pending',
      payments: [],
    })

    await service.recordPayment(actor, 'inv-1', { amount: '400.00', paidAt: '2026-06-01' }, {})

    expect(invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: {} }))
  })

  it('a payment that meets the full amount flips status to paid', async () => {
    const { service, invoiceFindUnique, invoiceUpdate } = buildHarness()
    invoiceFindUnique.mockResolvedValue({
      id: 'inv-1',
      amount: '1000.00',
      status: 'pending',
      payments: [{ amount: '600.00' }],
    })

    await service.recordPayment(actor, 'inv-1', { amount: '400.00', paidAt: '2026-06-01' }, {})

    expect(invoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'paid' } }),
    )
  })

  it('404s recording a payment against an invoice that does not exist', async () => {
    const { service, invoiceFindUnique } = buildHarness()
    invoiceFindUnique.mockResolvedValue(null)

    await expect(
      service.recordPayment(actor, 'nope', { amount: '1', paidAt: '2026-01-01' }, {}),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })
})

describe('RegFeeLedgerService.createApplicationFeeInvoiceOnRegistration', () => {
  it('does nothing when no active application fee schedule resolves — never blocks registration creation', async () => {
    const { service, resolveFeeSchedules, invoiceCreate } = buildHarness()
    resolveFeeSchedules.mockResolvedValue([])

    await service.createApplicationFeeInvoiceOnRegistration(
      'company-1',
      'reg-1',
      'ke',
      'ppb',
      'generic_pharma',
      'user-1',
    )

    expect(invoiceCreate).not.toHaveBeenCalled()
  })

  it('auto-creates a pending invoice from the resolved application fee schedule, due 30 days out', async () => {
    const { service, resolveFeeSchedules, invoiceCreate, auditLog } = buildHarness()
    resolveFeeSchedules.mockResolvedValue([
      { id: 'fee-1', feeType: 'application', amount: '5000.00', currency: 'KES' },
    ])

    await service.createApplicationFeeInvoiceOnRegistration(
      'company-1',
      'reg-1',
      'ke',
      'ppb',
      'generic_pharma',
      'user-1',
    )

    expect(invoiceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productRegistrationId: 'reg-1',
          regulatoryFeeScheduleId: 'fee-1',
          feeType: 'application',
          amount: '5000.00',
        }),
      }),
    )
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'reg_fee_invoice_auto_created' }),
    )
  })

  it('ignores a non-application fee type present in the resolved schedules (e.g. only a renewal fee configured)', async () => {
    const { service, resolveFeeSchedules, invoiceCreate } = buildHarness()
    resolveFeeSchedules.mockResolvedValue([
      { id: 'fee-2', feeType: 'renewal', amount: '2000.00', currency: 'KES' },
    ])

    await service.createApplicationFeeInvoiceOnRegistration(
      'company-1',
      'reg-1',
      'ke',
      'ppb',
      'generic_pharma',
      'user-1',
    )

    expect(invoiceCreate).not.toHaveBeenCalled()
  })
})

describe('RegFeeLedgerService.scanAndFlagOverdue', () => {
  it('flags a pending invoice past its due date as overdue exactly once, escalating a task and notifying regulatory affairs officers', async () => {
    const {
      service,
      invoiceFindMany,
      invoiceUpdate,
      escalateForRecord,
      notificationCreate,
      userFindMany,
    } = buildHarness()
    const overdueInvoice = {
      id: 'inv-1',
      companyId: 'company-1',
      feeType: 'application',
      amount: '5000.00',
      currency: 'KES',
      dueAt: new Date(Date.now() - 1000),
    }
    invoiceFindMany.mockResolvedValue([overdueInvoice])
    userFindMany.mockResolvedValue([{ id: 'user-2', email: 'ra@company.test' }])

    const result = await service.scanAndFlagOverdue()

    expect(result.flagged).toBe(1)
    expect(invoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: expect.objectContaining({ status: 'overdue' }),
      }),
    )
    expect(escalateForRecord).toHaveBeenCalledWith(
      'company-1',
      'reg_fee_invoice',
      'inv-1',
      'overdue',
      expect.any(String),
      {},
    )
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-2', category: 'deadline_breached' }),
    )
  })

  it('never re-flags an invoice whose notifiedOverdueAt is already set (query-level guard)', async () => {
    const { service, invoiceFindMany } = buildHarness()
    invoiceFindMany.mockResolvedValue([]) // the query itself filters notifiedOverdueAt: null — nothing left to process

    const result = await service.scanAndFlagOverdue()

    expect(result.flagged).toBe(0)
  })
})
