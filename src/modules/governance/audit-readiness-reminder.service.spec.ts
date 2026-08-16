import { AuditReadinessReminderService } from './audit-readiness-reminder.service'

describe('AuditReadinessReminderService', () => {
  function buildHarness(
    companies: { id: string; status: string }[],
    mostRecentTaskAt: Date | null,
    notReadyRows: { isMandatory: boolean; status: string; title: string }[],
  ) {
    const rls = {
      runWithSystemAccess: (fn: (tx: unknown) => unknown) =>
        fn({ company: { findMany: jest.fn().mockResolvedValue(companies) } }),
      runAsCompany: (_companyId: string, fn: (tx: unknown) => unknown) =>
        fn({
          task: {
            findFirst: jest
              .fn()
              .mockResolvedValue(mostRecentTaskAt ? { createdAt: mostRecentTaskAt } : null),
          },
        }),
    }
    const createForWorkflowState = jest.fn().mockResolvedValue({})
    const tasksService = { createForWorkflowState } as never
    const auditReadinessService = {
      getDashboard: jest
        .fn()
        .mockResolvedValue({
          overall: 'red',
          readyCount: 0,
          totalMandatory: 1,
          rows: notReadyRows,
        }),
    } as never

    const service = new AuditReadinessReminderService(
      rls as never,
      tasksService,
      auditReadinessService,
    )
    return { service, createForWorkflowState }
  }

  it('creates a reminder for a company with a not-ready mandatory row and no recent reminder', async () => {
    const { service, createForWorkflowState } = buildHarness(
      [{ id: 'company-1', status: 'active' }],
      null,
      [{ isMandatory: true, status: 'missing', title: 'PSMF in place' }],
    )

    const result = await service.scanAndRemind()
    expect(result.remindersCreated).toBe(1)
    expect(createForWorkflowState).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'company-1', assignedRoleKey: 'QPPV' }),
      {},
    )
  })

  it('does not remind a company whose dashboard is already fully ready', async () => {
    const { service, createForWorkflowState } = buildHarness(
      [{ id: 'company-1', status: 'active' }],
      null,
      [{ isMandatory: true, status: 'ready', title: 'PSMF in place' }],
    )

    const result = await service.scanAndRemind()
    expect(result.remindersCreated).toBe(0)
    expect(createForWorkflowState).not.toHaveBeenCalled()
  })

  it('does not remind a company reminded within the last 30 days', async () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    const { service, createForWorkflowState } = buildHarness(
      [{ id: 'company-1', status: 'active' }],
      recent,
      [{ isMandatory: true, status: 'missing', title: 'PSMF in place' }],
    )

    const result = await service.scanAndRemind()
    expect(result.remindersCreated).toBe(0)
    expect(createForWorkflowState).not.toHaveBeenCalled()
  })

  it('reminds again once the throttle window has passed', async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    const { service, createForWorkflowState } = buildHarness(
      [{ id: 'company-1', status: 'active' }],
      old,
      [{ isMandatory: true, status: 'missing', title: 'PSMF in place' }],
    )

    const result = await service.scanAndRemind()
    expect(result.remindersCreated).toBe(1)
    expect(createForWorkflowState).toHaveBeenCalled()
  })
})
