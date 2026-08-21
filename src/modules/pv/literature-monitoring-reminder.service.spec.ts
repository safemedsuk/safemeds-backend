import { LiteratureMonitoringReminderService } from './literature-monitoring-reminder.service'

function buildHarness() {
  const companies = [{ id: 'company-1' }]
  const taskFindFirst = jest.fn().mockResolvedValue(null)
  const runFindFirst = jest.fn().mockResolvedValue(null)
  const tables = {
    task: { findFirst: taskFindFirst },
    literatureMonitoringRun: { findFirst: runFindFirst },
  }

  const rls = {
    runWithSystemAccess: (fn: (tx: { company: { findMany: jest.Mock } }) => unknown) =>
      fn({ company: { findMany: jest.fn().mockResolvedValue(companies) } }),
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const createForWorkflowState = jest.fn().mockResolvedValue({ id: 'task-1' })
  const tasksService = { createForWorkflowState } as never

  const service = new LiteratureMonitoringReminderService(rls as never, tasksService)
  return { service, taskFindFirst, runFindFirst, createForWorkflowState }
}

describe('LiteratureMonitoringReminderService', () => {
  it('creates a reminder when no run has ever been logged', async () => {
    const { service, createForWorkflowState } = buildHarness()
    const result = await service.scanAndRemind()

    expect(result).toEqual({ companiesScanned: 1, remindersCreated: 1 })
    expect(createForWorkflowState).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'company-1', assignedRoleKey: 'QPPV' }),
      {},
    )
  })

  it('does not remind when a recent run already exists', async () => {
    const { service, runFindFirst, createForWorkflowState } = buildHarness()
    runFindFirst.mockResolvedValue({ runAt: new Date() })

    const result = await service.scanAndRemind()

    expect(result.remindersCreated).toBe(0)
    expect(createForWorkflowState).not.toHaveBeenCalled()
  })

  it('reminds again when the only run is older than the currency window', async () => {
    const { service, runFindFirst } = buildHarness()
    const stale = new Date()
    stale.setDate(stale.getDate() - 60)
    runFindFirst.mockResolvedValue({ runAt: stale })

    const result = await service.scanAndRemind()
    expect(result.remindersCreated).toBe(1)
  })

  it('does not create a second reminder while a recent one is still open', async () => {
    const { service, taskFindFirst, createForWorkflowState } = buildHarness()
    taskFindFirst.mockResolvedValue({ createdAt: new Date() })

    const result = await service.scanAndRemind()
    expect(result.remindersCreated).toBe(0)
    expect(createForWorkflowState).not.toHaveBeenCalled()
  })
})
