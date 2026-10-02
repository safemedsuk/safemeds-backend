import { RegQueryReminderService } from './reg-query-reminder.service'

function buildHarness() {
  const escalateForRecord = jest.fn().mockResolvedValue(undefined)
  const tasksService = { escalateForRecord } as never

  const create = jest.fn().mockResolvedValue(undefined)
  const sendExternalEmail = jest.fn().mockResolvedValue(undefined)
  const notificationsService = { create, sendExternalEmail } as never

  const decrypt = jest.fn((ciphertext: string) => ciphertext.replace(/^enc\(/, '').replace(/\)$/, ''))
  const encryptionService = { decrypt } as never

  const regQueryFindMany = jest.fn().mockResolvedValue([])
  const userFindMany = jest.fn().mockResolvedValue([{ id: 'ra-officer-1', email: 'ra@example.com' }])

  const tables = { regQuery: { findMany: regQueryFindMany }, user: { findMany: userFindMany } }
  const rls = {
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new RegQueryReminderService(rls as never, notificationsService, tasksService, encryptionService)
  return { service, escalateForRecord, create, sendExternalEmail, regQueryFindMany, userFindMany }
}

const dueSoonQuery = {
  id: 'query-1',
  companyId: 'company-1',
  status: 'open',
  responseDueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
  queryTextEncrypted: 'enc(Please clarify the CPP validity.)',
  company: { regulatoryContactEmail: 'compliance@fankammeds.example' },
  owner: { id: 'owner-1', email: 'owner@example.com', status: 'active' },
}

const overdueQuery = {
  ...dueSoonQuery,
  id: 'query-2',
  status: 'in_progress',
  responseDueDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
}

describe('RegQueryReminderService.scanAndRemind', () => {
  it('scans only open/in_progress queries with a real response due date', async () => {
    const { service, regQueryFindMany } = buildHarness()
    await service.scanAndRemind()

    expect(regQueryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['open', 'in_progress'] }, responseDueDate: { not: null } },
      }),
    )
  })

  it('sends a plain in-app reminder to the owner while still due-soon, with no escalation and no email', async () => {
    const { service, regQueryFindMany, create, escalateForRecord, sendExternalEmail } = buildHarness()
    regQueryFindMany.mockResolvedValue([dueSoonQuery])

    const result = await service.scanAndRemind()

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        userId: 'owner-1',
        category: 'deadline_approaching',
        recordType: 'reg_query',
        recordId: 'query-1',
        title: expect.stringContaining('due'),
      }),
    )
    expect(escalateForRecord).not.toHaveBeenCalled()
    expect(sendExternalEmail).not.toHaveBeenCalled()
    expect(result).toEqual({ queriesScanned: 1, remindersSent: 1, escalationsSent: 0 })
  })

  it('escalates to a real Task (the SYSTEM_ADMINISTRATOR-queue "manager" proxy) and emails the company contact once overdue', async () => {
    const { service, regQueryFindMany, escalateForRecord, sendExternalEmail, create } = buildHarness()
    regQueryFindMany.mockResolvedValue([overdueQuery])

    const result = await service.scanAndRemind()

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner-1', title: expect.stringContaining('Overdue') }),
    )
    expect(escalateForRecord).toHaveBeenCalledWith(
      'company-1',
      'reg_query',
      'query-2',
      'overdue',
      expect.stringContaining('Overdue'),
      {},
    )
    expect(sendExternalEmail).toHaveBeenCalledWith(
      'compliance@fankammeds.example',
      expect.stringContaining('Overdue'),
      expect.anything(),
    )
    expect(result).toEqual({ queriesScanned: 1, remindersSent: 0, escalationsSent: 1 })
  })

  it('falls back to every REGULATORY_AFFAIRS_OFFICER when the query has no active owner', async () => {
    const { service, regQueryFindMany, userFindMany, create } = buildHarness()
    regQueryFindMany.mockResolvedValue([{ ...dueSoonQuery, owner: null }])

    await service.scanAndRemind()

    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ roleKeys: { has: 'REGULATORY_AFFAIRS_OFFICER' } }),
      }),
    )
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'ra-officer-1' }))
  })

  it('never throws — just skips the email — when the company has no regulatoryContactEmail on file yet, even once overdue', async () => {
    const { service, regQueryFindMany, sendExternalEmail } = buildHarness()
    regQueryFindMany.mockResolvedValue([
      { ...overdueQuery, company: { regulatoryContactEmail: null } },
    ])

    await expect(service.scanAndRemind()).resolves.toBeDefined()
    expect(sendExternalEmail).not.toHaveBeenCalled()
  })
})
