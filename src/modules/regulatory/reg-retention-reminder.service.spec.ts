import { RegRetentionReminderService } from './reg-retention-reminder.service'

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

  const service = new RegRetentionReminderService(rls as never, tasksService, notificationsService)
  return { service, escalateForRecord, create, sendExternalEmail, productRegistrationFindMany }
}

const activeRegistration = {
  id: 'reg-1',
  companyId: 'company-1',
  registrationNumber: 'PPB-2026-0142',
  product: { brandName: 'Amoxiclav' },
  company: { regulatoryContactEmail: 'compliance@fankammeds.example' },
  regRetentions: [],
}

describe('RegRetentionReminderService.scanAndRemind', () => {
  it('is a no-op outside the 1 October – 31 December window', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-15T00:00:00Z'))
    const { service, productRegistrationFindMany } = buildHarness()

    const result = await service.scanAndRemind()

    expect(productRegistrationFindMany).not.toHaveBeenCalled()
    expect(result).toEqual({ registrationsScanned: 0, remindersSent: 0 })
    jest.useRealTimers()
  })

  it('scans within the window (e.g. 1 October) and reminds a registration with no retention logged yet for the current year', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T00:00:00Z'))
    const { service, productRegistrationFindMany, escalateForRecord, create, sendExternalEmail } =
      buildHarness()
    productRegistrationFindMany.mockResolvedValue([activeRegistration])

    const result = await service.scanAndRemind()

    expect(escalateForRecord).toHaveBeenCalledWith(
      'company-1',
      'reg_retention_reminder',
      'reg-1',
      'due_soon',
      expect.stringContaining('2026 retention due'),
      {},
    )
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'deadline_approaching', recordId: 'reg-1' }),
    )
    expect(sendExternalEmail).toHaveBeenCalledWith(
      'compliance@fankammeds.example',
      expect.stringContaining('2026 retention due'),
      expect.any(String),
    )
    expect(result).toEqual({ registrationsScanned: 1, remindersSent: 1 })
    jest.useRealTimers()
  })

  it('skips a registration that already has a retention logged for the current year (self-terminating)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-15T00:00:00Z'))
    const { service, productRegistrationFindMany, escalateForRecord } = buildHarness()
    productRegistrationFindMany.mockResolvedValue([
      { ...activeRegistration, regRetentions: [{ id: 'ret-1' }] },
    ])

    const result = await service.scanAndRemind()

    expect(escalateForRecord).not.toHaveBeenCalled()
    expect(result).toEqual({ registrationsScanned: 1, remindersSent: 0 })
    jest.useRealTimers()
  })

  it('still runs on 31 December (end of window, inclusive)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-12-31T23:00:00Z'))
    const { service, productRegistrationFindMany } = buildHarness()
    productRegistrationFindMany.mockResolvedValue([activeRegistration])

    const result = await service.scanAndRemind()
    expect(result.remindersSent).toBe(1)
    jest.useRealTimers()
  })
})
