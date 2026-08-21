import { PhoneReachabilityReminderService } from './phone-reachability-reminder.service'

function buildHarness() {
  const companies = [{ id: 'company-1' }]
  const taskFindFirst = jest.fn().mockResolvedValue(null)
  const contactTestFindFirst = jest.fn().mockResolvedValue(null)
  const tables = {
    task: { findFirst: taskFindFirst },
    contactTest: { findFirst: contactTestFindFirst },
  }

  const rls = {
    runWithSystemAccess: (fn: (tx: { company: { findMany: jest.Mock } }) => unknown) =>
      fn({ company: { findMany: jest.fn().mockResolvedValue(companies) } }),
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const createForWorkflowState = jest.fn().mockResolvedValue({ id: 'task-1' })
  const tasksService = { createForWorkflowState } as never

  const service = new PhoneReachabilityReminderService(rls as never, tasksService)
  return { service, taskFindFirst, contactTestFindFirst, createForWorkflowState }
}

describe('PhoneReachabilityReminderService', () => {
  it('creates a reminder when no phone-channel ContactTest has ever been initiated', async () => {
    const { service, contactTestFindFirst, createForWorkflowState } = buildHarness()
    const result = await service.scanAndRemind()

    expect(contactTestFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'company-1', channel: 'phone' } }),
    )
    expect(result).toEqual({ companiesScanned: 1, remindersCreated: 1 })
    expect(createForWorkflowState).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'company-1', assignedRoleKey: 'QPPV' }),
      {},
    )
  })

  it('does not remind when a recent phone test already exists', async () => {
    const { service, contactTestFindFirst, createForWorkflowState } = buildHarness()
    contactTestFindFirst.mockResolvedValue({ createdAt: new Date() })

    const result = await service.scanAndRemind()
    expect(result.remindersCreated).toBe(0)
    expect(createForWorkflowState).not.toHaveBeenCalled()
  })

  it('reminds again when the only phone test is older than the reachability window', async () => {
    const { service, contactTestFindFirst } = buildHarness()
    const stale = new Date()
    stale.setDate(stale.getDate() - 45)
    contactTestFindFirst.mockResolvedValue({ createdAt: stale })

    const result = await service.scanAndRemind()
    expect(result.remindersCreated).toBe(1)
  })
})
