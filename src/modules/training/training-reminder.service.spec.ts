import { TrainingReminderService } from './training-reminder.service'

describe('TrainingReminderService', () => {
  function buildHarness(
    records: {
      id: string
      companyId: string
      userId: string
      title: string
      expiryDate: Date | null
    }[],
    alreadyReminded: boolean,
  ) {
    const rls = {
      runWithSystemAccess: (fn: (tx: unknown) => unknown) =>
        fn({ trainingRecord: { findMany: jest.fn().mockResolvedValue(records) } }),
      runAsCompany: (_companyId: string, fn: (tx: unknown) => unknown) =>
        fn({
          task: {
            findFirst: jest.fn().mockResolvedValue(alreadyReminded ? { id: 'task-1' } : null),
          },
        }),
    }
    const createForWorkflowState = jest.fn().mockResolvedValue({})
    const tasksService = { createForWorkflowState } as never

    const service = new TrainingReminderService(rls as never, tasksService)
    return { service, createForWorkflowState }
  }

  it('reminds the individual staff member (assignedUserId, not a role) for an expiring record', async () => {
    const soon = new Date()
    soon.setDate(soon.getDate() + 10)
    const { service, createForWorkflowState } = buildHarness(
      [
        {
          id: 'tr-1',
          companyId: 'company-1',
          userId: 'staff-1',
          title: 'GVP Refresher',
          expiryDate: soon,
        },
      ],
      false,
    )

    const result = await service.scanAndRemind()
    expect(result.remindersCreated).toBe(1)
    expect(createForWorkflowState).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: 'tr-1', assignedUserId: 'staff-1' }),
      {},
    )
  })

  it('does not double-remind the same record', async () => {
    const soon = new Date()
    soon.setDate(soon.getDate() + 5)
    const { service, createForWorkflowState } = buildHarness(
      [{ id: 'tr-1', companyId: 'company-1', userId: 'staff-1', title: 'x', expiryDate: soon }],
      true,
    )

    const result = await service.scanAndRemind()
    expect(result.remindersCreated).toBe(0)
    expect(createForWorkflowState).not.toHaveBeenCalled()
  })
})
