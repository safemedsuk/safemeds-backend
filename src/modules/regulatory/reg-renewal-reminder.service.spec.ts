import { RegRenewalReminderService } from './reg-renewal-reminder.service'

function buildHarness() {
  const escalateForRecord = jest.fn().mockResolvedValue(undefined)
  const tasksService = { escalateForRecord } as never

  const create = jest.fn().mockResolvedValue(undefined)
  const sendExternalEmail = jest.fn().mockResolvedValue(undefined)
  const notificationsService = { create, sendExternalEmail } as never

  const productRegistrationFindMany = jest.fn().mockResolvedValue([])
  const userFindMany = jest.fn().mockResolvedValue([{ id: 'ra-officer-1' }])

  const tables = {
    productRegistration: { findMany: productRegistrationFindMany },
    user: { findMany: userFindMany },
  }
  const rls = {
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new RegRenewalReminderService(rls as never, tasksService, notificationsService)
  return { service, escalateForRecord, create, sendExternalEmail, productRegistrationFindMany, userFindMany }
}

const registrationDueSoon = {
  id: 'reg-1',
  companyId: 'company-1',
  registrationNumber: 'PPB-2026-0142',
  expiresOn: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
  product: { brandName: 'Amoxiclav' },
  company: { regulatoryContactEmail: 'compliance@fankammeds.example' },
}

describe('RegRenewalReminderService.scanAndRemind', () => {
  it('queries only active registrations expiring within 6 months, not yet expired', async () => {
    const { service, productRegistrationFindMany } = buildHarness()
    await service.scanAndRemind()

    expect(productRegistrationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'active', expiresOn: { gt: expect.any(Date), lte: expect.any(Date) } },
      }),
    )
  })

  it('escalates a real Task, notifies every REGULATORY_AFFAIRS_OFFICER, and emails the company contact', async () => {
    const { service, productRegistrationFindMany, escalateForRecord, create, sendExternalEmail } =
      buildHarness()
    productRegistrationFindMany.mockResolvedValue([registrationDueSoon])

    const result = await service.scanAndRemind()

    expect(escalateForRecord).toHaveBeenCalledWith(
      'company-1',
      'reg_registration_renewal_reminder',
      'reg-1',
      'due_soon',
      expect.stringContaining('Amoxiclav'),
      {},
    )
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        userId: 'ra-officer-1',
        category: 'deadline_approaching',
        recordType: 'product_registration',
        recordId: 'reg-1',
      }),
    )
    expect(sendExternalEmail).toHaveBeenCalledWith(
      'compliance@fankammeds.example',
      expect.stringContaining('Amoxiclav'),
      expect.stringContaining('PPB-2026-0142'),
    )
    expect(result).toEqual({ registrationsScanned: 1, remindersSent: 1 })
  })

  it('never throws — just skips the email — when the company has no regulatoryContactEmail on file yet', async () => {
    const { service, productRegistrationFindMany, sendExternalEmail } = buildHarness()
    productRegistrationFindMany.mockResolvedValue([
      { ...registrationDueSoon, company: { regulatoryContactEmail: null } },
    ])

    await expect(service.scanAndRemind()).resolves.toBeDefined()
    expect(sendExternalEmail).not.toHaveBeenCalled()
  })
})
