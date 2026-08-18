import { ProductReviewReminderService } from './product-review-reminder.service'

function buildHarness(
  companies: { id: string; status: string }[],
  existingTasksByCompany: Record<string, { createdAt: Date }[]>,
) {
  const companyFindMany = jest
    .fn()
    .mockImplementation(({ where }: { where: { status: string } }) =>
      Promise.resolve(
        companies.filter((c) => c.status === where.status).map((c) => ({ id: c.id })),
      ),
    )

  const taskFindFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: { companyId: string; recordType: string } }) => {
      const tasks = existingTasksByCompany[where.companyId] ?? []
      if (tasks.length === 0) return Promise.resolve(null)
      return Promise.resolve(
        [...tasks].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0],
      )
    })

  const tables = { company: { findMany: companyFindMany }, task: { findFirst: taskFindFirst } }
  const rls = {
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const createForWorkflowState = jest.fn().mockResolvedValue({ id: 'task-1' })
  const tasksService = { createForWorkflowState } as never

  const service = new ProductReviewReminderService(rls as never, tasksService)
  return { service, createForWorkflowState, companyFindMany, taskFindFirst }
}

describe('ProductReviewReminderService.scanAndRemind', () => {
  it('creates a reminder task for a company that has never had one', async () => {
    const { service, createForWorkflowState } = buildHarness(
      [{ id: 'company-1', status: 'active' }],
      {},
    )

    const result = await service.scanAndRemind()

    expect(createForWorkflowState).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        recordType: 'product_list_review',
        recordId: 'company-1',
        assignedRoleKey: 'SYSTEM_ADMINISTRATOR',
      }),
      {},
    )
    expect(result).toEqual({ companiesScanned: 1, remindersCreated: 1 })
  })

  it('does not create a second reminder if the most recent one is less than a quarter old', async () => {
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) // 10 days ago
    const { service, createForWorkflowState } = buildHarness(
      [{ id: 'company-1', status: 'active' }],
      { 'company-1': [{ createdAt: recent }] },
    )

    const result = await service.scanAndRemind()

    expect(createForWorkflowState).not.toHaveBeenCalled()
    expect(result).toEqual({ companiesScanned: 1, remindersCreated: 0 })
  })

  it('creates a new reminder once the most recent one is older than a quarter', async () => {
    const stale = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) // 100 days ago
    const { service, createForWorkflowState } = buildHarness(
      [{ id: 'company-1', status: 'active' }],
      { 'company-1': [{ createdAt: stale }] },
    )

    const result = await service.scanAndRemind()

    expect(createForWorkflowState).toHaveBeenCalledTimes(1)
    expect(result.remindersCreated).toBe(1)
  })

  it('never reminds a suspended company', async () => {
    const { service, createForWorkflowState } = buildHarness(
      [{ id: 'company-1', status: 'suspended' }],
      {},
    )

    const result = await service.scanAndRemind()

    expect(createForWorkflowState).not.toHaveBeenCalled()
    expect(result).toEqual({ companiesScanned: 0, remindersCreated: 0 })
  })

  it('scans every active company independently — one being up to date does not block another that is due', async () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    const { service, createForWorkflowState } = buildHarness(
      [
        { id: 'company-1', status: 'active' },
        { id: 'company-2', status: 'active' },
      ],
      { 'company-1': [{ createdAt: recent }] },
    )

    const result = await service.scanAndRemind()

    expect(createForWorkflowState).toHaveBeenCalledTimes(1)
    expect(createForWorkflowState).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'company-2' }),
      {},
    )
    expect(result).toEqual({ companiesScanned: 2, remindersCreated: 1 })
  })
})
