import { RegDeadlineService } from './reg-deadline.service'

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const resolveDeadlineRule = jest.fn()
  const regConfigService = { resolveDeadlineRule } as never

  const regDeadlineUpsert = jest
    .fn()
    .mockImplementation(({ create }) => Promise.resolve({ id: 'deadline-1', ...create }))
  const regDeadlineUpdate = jest
    .fn()
    .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))
  const regDeadlineFindUnique = jest.fn().mockResolvedValue(null)
  const regDeadlineFindMany = jest.fn().mockResolvedValue([])
  const regDeadlineCount = jest.fn().mockResolvedValue(0)

  const tables = {
    regDeadline: {
      upsert: regDeadlineUpsert,
      update: regDeadlineUpdate,
      findUnique: regDeadlineFindUnique,
      findMany: regDeadlineFindMany,
      count: regDeadlineCount,
    },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new RegDeadlineService(rls as never, auditService, regConfigService)
  return {
    service,
    auditLog,
    resolveDeadlineRule,
    regDeadlineUpsert,
    regDeadlineUpdate,
    regDeadlineFindMany,
  }
}

describe('RegDeadlineService.computeOrRecompute', () => {
  it('returns null and writes nothing when no rule resolves — never blocks the caller (e.g. an unconfigured market)', async () => {
    const { service, resolveDeadlineRule, regDeadlineUpsert } = buildHarness()
    resolveDeadlineRule.mockResolvedValue(null)

    const result = await service.computeOrRecompute({
      companyId: 'c1',
      recordType: 'reg_registration_renewal',
      recordId: 'reg-1',
      countryId: 'tz',
      authorityId: 'tmda',
      productClass: '*',
      obligationType: 'renewal',
      triggerDate: new Date('2026-01-01T00:00:00.000Z'),
    })

    expect(result).toBeNull()
    expect(regDeadlineUpsert).not.toHaveBeenCalled()
  })

  it("computes dueAt from the resolved rule using real calendar-year arithmetic (Kenya's real 5-year renewal shape)", async () => {
    const { service, resolveDeadlineRule, regDeadlineUpsert, auditLog } = buildHarness()
    resolveDeadlineRule.mockResolvedValue({
      id: 'rule-ke-renewal',
      intervalValue: 5,
      intervalUnit: 'years',
    })

    const deadline = await service.computeOrRecompute({
      companyId: 'c1',
      recordType: 'reg_registration_renewal',
      recordId: 'reg-1',
      countryId: 'ke',
      authorityId: 'ppb',
      productClass: '*',
      obligationType: 'renewal',
      triggerDate: new Date('2026-03-01T00:00:00.000Z'),
      actorUserId: 'user-1',
    })

    expect(deadline?.dueAt.toISOString()).toBe('2031-03-01T00:00:00.000Z')
    expect(regDeadlineUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          recordType_recordId: { recordType: 'reg_registration_renewal', recordId: 'reg-1' },
        },
        create: expect.objectContaining({
          regDeadlineRuleId: 'rule-ke-renewal',
          status: 'pending',
        }),
      }),
    )
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'reg_deadline_computed', actorUserId: 'user-1' }),
    )
  })

  it('a recompute clears prior escalation-notified flags, since the new due date may no longer be within an already-fired threshold', async () => {
    const { service, resolveDeadlineRule, regDeadlineUpsert } = buildHarness()
    resolveDeadlineRule.mockResolvedValue({
      id: 'rule-1',
      intervalValue: 12,
      intervalUnit: 'months',
    })

    await service.computeOrRecompute({
      companyId: 'c1',
      recordType: 'reg_registration_renewal',
      recordId: 'reg-1',
      countryId: 'ke',
      authorityId: 'ppb',
      productClass: '*',
      obligationType: 'renewal',
      triggerDate: new Date('2026-01-01T00:00:00.000Z'),
    })

    expect(regDeadlineUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          notifiedAt180d: null,
          notifiedAt90d: null,
          notifiedAt30d: null,
          breachedAt: null,
        }),
      }),
    )
  })
})

describe('RegDeadlineService.scanAndEscalate', () => {
  it('marks an overdue pending deadline as missed and calls onBreach', async () => {
    const { service, regDeadlineFindMany } = buildHarness()
    const overdueDeadline = {
      id: 'd1',
      status: 'pending',
      dueAt: new Date(Date.now() - 1000),
      companyId: 'c1',
      recordType: 'reg_registration_renewal',
      recordId: 'r1',
    }
    regDeadlineFindMany.mockResolvedValueOnce([overdueDeadline]).mockResolvedValue([])

    const onBreach = jest.fn().mockResolvedValue(undefined)
    const onApproaching = jest.fn().mockResolvedValue(undefined)

    const result = await service.scanAndEscalate({ onBreach, onApproaching })

    expect(result.breached).toBe(1)
    expect(onBreach).toHaveBeenCalledWith(overdueDeadline)
  })

  it('flags a deadline within the 30-day window and never re-notifies once notifiedAt30d is already set', async () => {
    const { service, regDeadlineFindMany } = buildHarness()
    // overdue scan → none; 30d scan → one; 90d/180d scans → none
    regDeadlineFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'd2', dueAt: new Date(), companyId: 'c1', recordType: 'x', recordId: 'r2' },
      ])
      .mockResolvedValue([])

    const onBreach = jest.fn().mockResolvedValue(undefined)
    const onApproaching = jest.fn().mockResolvedValue(undefined)
    const result = await service.scanAndEscalate({ onBreach, onApproaching })

    expect(result.d30).toBe(1)
    expect(onApproaching).toHaveBeenCalledWith(expect.objectContaining({ id: 'd2' }), '30d')
  })
})
