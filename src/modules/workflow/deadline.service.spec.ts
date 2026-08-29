import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { DeadlineService } from './deadline.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const resolveReportingRule = jest.fn()
  const ruleResolutionService = { resolveReportingRule } as never

  const deadlineCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const deadlineUpdate = jest
    .fn()
    .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))
  const deadlineFindUnique = jest.fn()
  const deadlineFindMany = jest.fn()
  const deadlineCount = jest.fn().mockResolvedValue(0)

  const tables = {
    deadline: {
      create: deadlineCreate,
      update: deadlineUpdate,
      findUnique: deadlineFindUnique,
      findMany: deadlineFindMany,
      count: deadlineCount,
    },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new DeadlineService(rls as never, auditService, ruleResolutionService)
  return {
    service,
    auditLog,
    resolveReportingRule,
    deadlineCreate,
    deadlineUpdate,
    deadlineFindUnique,
    deadlineFindMany,
  }
}

describe('DeadlineService.computeFor', () => {
  it('computes dueAt from the resolved rule (calendar days) and audits it', async () => {
    const { service, resolveReportingRule, auditLog } = buildHarness()
    resolveReportingRule.mockResolvedValue({
      id: 'rule-1',
      windowDays: 15,
      dayType: 'calendar',
      unverified: false,
    })

    const deadline = await service.computeFor(
      actor,
      {
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'record-1',
        authorityId: 'ppb',
        reportTypeId: 'adr',
        seriousnessClass: 'serious',
        awarenessDate: new Date('2026-01-01T00:00:00.000Z'),
      },
      {},
    )

    expect(deadline.dueAt.toISOString()).toBe('2026-01-16T00:00:00.000Z')
    expect(deadline.status).toBe('pending')
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'deadline_computed' }),
    )
  })

  it('throws NO_ACTIVE_RULE when nothing resolves', async () => {
    const { service, resolveReportingRule } = buildHarness()
    resolveReportingRule.mockResolvedValue(null)

    await expect(
      service.computeFor(
        actor,
        {
          companyId: 'c1',
          recordType: 'pv_case',
          recordId: 'r1',
          authorityId: 'a',
          reportTypeId: 'rt',
          seriousnessClass: 'serious',
          awarenessDate: new Date(),
        },
        {},
      ),
    ).rejects.toMatchObject({ response: { code: 'NO_ACTIVE_RULE' } })
  })

  it('refuses to compute from an unverified rule (belt-and-braces — should never actually resolve as active)', async () => {
    const { service, resolveReportingRule } = buildHarness()
    resolveReportingRule.mockResolvedValue({
      id: 'rule-1',
      windowDays: 7,
      dayType: 'calendar',
      unverified: true,
    })

    await expect(
      service.computeFor(
        actor,
        {
          companyId: 'c1',
          recordType: 'pv_case',
          recordId: 'r1',
          authorityId: 'a',
          reportTypeId: 'rt',
          seriousnessClass: 'serious',
          awarenessDate: new Date(),
        },
        {},
      ),
    ).rejects.toMatchObject({ response: { code: 'RULE_UNVERIFIED' } })
  })
})

describe('DeadlineService.recompute', () => {
  it('re-resolves the rule and records the old→new due date', async () => {
    const { service, deadlineFindUnique, resolveReportingRule, auditLog } = buildHarness()
    deadlineFindUnique.mockResolvedValue({
      id: 'deadline-1',
      companyId: 'company-1',
      recordType: 'pv_case',
      recordId: 'record-1',
      reportingRuleId: 'rule-old',
      dueAt: new Date('2026-01-16T00:00:00.000Z'),
      reportingRule: { authorityId: 'ppb', reportTypeId: 'adr' },
    })
    resolveReportingRule.mockResolvedValue({ id: 'rule-new', windowDays: 7, dayType: 'calendar' })

    const updated = await service.recompute(
      actor,
      'deadline-1',
      'non_serious',
      new Date('2026-01-01T00:00:00.000Z'),
      {},
    )

    expect(updated.dueAt.toISOString()).toBe('2026-01-08T00:00:00.000Z')
    expect(updated.status).toBe('recalculated')
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'deadline_recomputed',
        oldValue: { dueAt: '2026-01-16T00:00:00.000Z', reportingRuleId: 'rule-old' },
        newValue: { dueAt: '2026-01-08T00:00:00.000Z', reportingRuleId: 'rule-new' },
      }),
    )
  })

  it('404s when the deadline does not exist', async () => {
    const { service, deadlineFindUnique } = buildHarness()
    deadlineFindUnique.mockResolvedValue(null)

    await expect(
      service.recompute(actor, 'missing', 'serious', new Date(), {}),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })
})

describe('DeadlineService.scanAndEscalate', () => {
  it('marks overdue pending deadlines as missed, audits, and notifies onBreach', async () => {
    const { service, deadlineFindMany } = buildHarness()
    const overdue = {
      id: 'd1',
      companyId: 'c1',
      recordType: 'pv_case',
      recordId: 'r1',
      dueAt: new Date('2020-01-01'),
    }
    deadlineFindMany
      .mockResolvedValueOnce([overdue])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const notifier = { onApproaching: jest.fn(), onBreach: jest.fn() }

    const result = await service.scanAndEscalate(notifier)

    expect(notifier.onBreach).toHaveBeenCalledWith(overdue)
    expect(result.breached).toBe(1)
  })

  it('notifies onApproaching for deadlines within the 24h and 72h windows, without double-processing breached ones', async () => {
    const { service, deadlineFindMany } = buildHarness()
    const approachingSoon = {
      id: 'd2',
      companyId: 'c1',
      recordType: 'pv_case',
      recordId: 'r2',
      dueAt: new Date(Date.now() + 12 * 3600 * 1000),
    }
    const approachingLater = {
      id: 'd3',
      companyId: 'c1',
      recordType: 'pv_case',
      recordId: 'r3',
      dueAt: new Date(Date.now() + 48 * 3600 * 1000),
    }
    deadlineFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([approachingSoon])
      .mockResolvedValueOnce([approachingLater])
    const notifier = { onApproaching: jest.fn(), onBreach: jest.fn() }

    const result = await service.scanAndEscalate(notifier)

    expect(notifier.onApproaching).toHaveBeenCalledWith(approachingSoon, '24h')
    expect(notifier.onApproaching).toHaveBeenCalledWith(approachingLater, '72h')
    expect(result).toEqual({ breached: 0, t24: 1, t72: 1 })
  })
})
