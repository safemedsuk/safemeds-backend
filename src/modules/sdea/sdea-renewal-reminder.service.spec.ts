import { SdeaRenewalReminderService } from './sdea-renewal-reminder.service'

describe('SdeaRenewalReminderService', () => {
  function buildHarness(
    sdeas: {
      id: string
      companyId: string
      distributorId: string
      title: string
      expiryDate: Date | null
    }[],
    alreadyReminded: boolean,
  ) {
    const rls = {
      runWithSystemAccess: (fn: (tx: unknown) => unknown) =>
        fn({ sdea: { findMany: jest.fn().mockResolvedValue(sdeas) } }),
      runAsCompany: (_companyId: string, fn: (tx: unknown) => unknown) =>
        fn({
          task: {
            findFirst: jest.fn().mockResolvedValue(alreadyReminded ? { id: 'task-1' } : null),
          },
        }),
    }
    const createForWorkflowState = jest.fn().mockResolvedValue({})
    const tasksService = { createForWorkflowState } as never

    const service = new SdeaRenewalReminderService(rls as never, tasksService)
    return { service, createForWorkflowState }
  }

  it('creates a reminder for an SDEA expiring soon with no prior reminder', async () => {
    const soon = new Date()
    soon.setDate(soon.getDate() + 30)
    const { service, createForWorkflowState } = buildHarness(
      [
        {
          id: 'sdea-1',
          companyId: 'company-1',
          distributorId: 'dist-1',
          title: 'Meridian SDEA',
          expiryDate: soon,
        },
      ],
      false,
    )

    const result = await service.scanAndRemind()
    expect(result.remindersCreated).toBe(1)
    expect(createForWorkflowState).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        recordId: 'sdea-1',
        assignedRoleKey: 'QUALITY_MANAGER',
      }),
      {},
    )
  })

  it('does not re-create a reminder that already exists for this SDEA', async () => {
    const soon = new Date()
    soon.setDate(soon.getDate() + 10)
    const { service, createForWorkflowState } = buildHarness(
      [
        {
          id: 'sdea-1',
          companyId: 'company-1',
          distributorId: 'dist-1',
          title: 'x',
          expiryDate: soon,
        },
      ],
      true,
    )

    const result = await service.scanAndRemind()
    expect(result.remindersCreated).toBe(0)
    expect(createForWorkflowState).not.toHaveBeenCalled()
  })

  it('reports zero when there are no expiring SDEAs at all', async () => {
    const { service } = buildHarness([], false)
    const result = await service.scanAndRemind()
    expect(result.sdeasScanned).toBe(0)
    expect(result.remindersCreated).toBe(0)
  })
})
