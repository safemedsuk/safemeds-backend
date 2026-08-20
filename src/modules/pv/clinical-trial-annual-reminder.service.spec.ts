import { ClinicalTrialAnnualReminderService } from './clinical-trial-annual-reminder.service'

function buildHarness(
  trials: {
    id: string
    companyId: string
    trialReference: string
    startDate: Date
    status?: string
  }[],
  existingTasksByTrial: Record<string, { createdAt: Date }[]>,
) {
  const clinicalTrialFindMany = jest
    .fn()
    .mockImplementation(({ where }: { where: { status: string } }) =>
      Promise.resolve(
        trials
          .filter((t) => (t.status ?? 'active') === where.status)
          .map((t) => ({
            id: t.id,
            companyId: t.companyId,
            trialReference: t.trialReference,
            startDate: t.startDate,
          })),
      ),
    )

  const taskFindFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: { recordId: string } }) => {
      const tasks = existingTasksByTrial[where.recordId] ?? []
      if (tasks.length === 0) return Promise.resolve(null)
      return Promise.resolve(
        [...tasks].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0],
      )
    })

  const tables = {
    clinicalTrial: { findMany: clinicalTrialFindMany },
    task: { findFirst: taskFindFirst },
  }
  const rls = {
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const createForWorkflowState = jest.fn().mockResolvedValue({ id: 'task-1' })
  const tasksService = { createForWorkflowState } as never

  const service = new ClinicalTrialAnnualReminderService(rls as never, tasksService)
  return { service, createForWorkflowState }
}

describe('ClinicalTrialAnnualReminderService.scanAndRemind', () => {
  it('creates a reminder task for a trial that has never had one, addressed to QPPV', async () => {
    const { service, createForWorkflowState } = buildHarness(
      [
        {
          id: 'trial-1',
          companyId: 'company-1',
          trialReference: 'NCT-001',
          startDate: new Date('2020-01-01'),
        },
      ],
      {},
    )

    const result = await service.scanAndRemind()

    expect(createForWorkflowState).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        recordType: 'clinical_trial_annual_renewal',
        recordId: 'trial-1',
        assignedRoleKey: 'QPPV',
      }),
      {},
    )
    expect(result).toEqual({ trialsScanned: 1, remindersCreated: 1 })
  })

  it('does not remind again within a year of the trial start when no prior reminder exists', async () => {
    const recentStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const { service, createForWorkflowState } = buildHarness(
      [
        {
          id: 'trial-1',
          companyId: 'company-1',
          trialReference: 'NCT-001',
          startDate: recentStart,
        },
      ],
      {},
    )

    const result = await service.scanAndRemind()

    expect(createForWorkflowState).not.toHaveBeenCalled()
    expect(result).toEqual({ trialsScanned: 1, remindersCreated: 0 })
  })

  it('does not create a second reminder if the most recent one is less than a year old', async () => {
    const recent = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const { service, createForWorkflowState } = buildHarness(
      [
        {
          id: 'trial-1',
          companyId: 'company-1',
          trialReference: 'NCT-001',
          startDate: new Date('2020-01-01'),
        },
      ],
      { 'trial-1': [{ createdAt: recent }] },
    )

    const result = await service.scanAndRemind()
    expect(createForWorkflowState).not.toHaveBeenCalled()
    expect(result.remindersCreated).toBe(0)
  })

  it('creates a new reminder once the most recent one is older than a year', async () => {
    const stale = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
    const { service, createForWorkflowState } = buildHarness(
      [
        {
          id: 'trial-1',
          companyId: 'company-1',
          trialReference: 'NCT-001',
          startDate: new Date('2020-01-01'),
        },
      ],
      { 'trial-1': [{ createdAt: stale }] },
    )

    const result = await service.scanAndRemind()
    expect(createForWorkflowState).toHaveBeenCalledTimes(1)
    expect(result.remindersCreated).toBe(1)
  })

  it('never scans a completed/terminated trial', async () => {
    const { service, createForWorkflowState } = buildHarness(
      [
        {
          id: 'trial-1',
          companyId: 'company-1',
          trialReference: 'NCT-001',
          startDate: new Date('2020-01-01'),
          status: 'completed',
        },
      ],
      {},
    )

    const result = await service.scanAndRemind()
    expect(createForWorkflowState).not.toHaveBeenCalled()
    expect(result).toEqual({ trialsScanned: 0, remindersCreated: 0 })
  })

  it('scans every active trial independently — one being up to date does not block another that is due', async () => {
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    const stale = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
    const { service, createForWorkflowState } = buildHarness(
      [
        {
          id: 'trial-1',
          companyId: 'company-1',
          trialReference: 'NCT-001',
          startDate: new Date('2020-01-01'),
        },
        {
          id: 'trial-2',
          companyId: 'company-1',
          trialReference: 'NCT-002',
          startDate: new Date('2020-01-01'),
        },
      ],
      { 'trial-1': [{ createdAt: recent }], 'trial-2': [{ createdAt: stale }] },
    )

    const result = await service.scanAndRemind()

    expect(createForWorkflowState).toHaveBeenCalledTimes(1)
    expect(createForWorkflowState).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: 'trial-2' }),
      {},
    )
    expect(result).toEqual({ trialsScanned: 2, remindersCreated: 1 })
  })
})
