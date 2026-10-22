import { DeviationInvestigationReminderService as Svc } from './deviation-investigation-reminder.service'

const DAY = 24 * 60 * 60 * 1000

describe('DeviationInvestigationReminderService — pure stage logic (Pass A2 item 5b)', () => {
  const due = new Date('2026-10-20T00:00:00Z')

  it('is quiet more than 3 days before the due date', () => {
    expect(Svc.targetStage(due, new Date(due.getTime() - 4 * DAY))).toBeNull()
  })

  it('is "approaching" inside the 3-day lead window', () => {
    expect(Svc.targetStage(due, new Date(due.getTime() - 3 * DAY))).toBe('approaching')
    expect(Svc.targetStage(due, new Date(due.getTime() - 1 * DAY))).toBe('approaching')
  })

  it('is "overdue" at and after the due date', () => {
    expect(Svc.targetStage(due, due)).toBe('overdue')
    expect(Svc.targetStage(due, new Date(due.getTime() + 5 * DAY))).toBe('overdue')
  })

  it('sends a stage only when it is new (never repeats approaching, never re-sends overdue)', () => {
    expect(Svc.isNewStage(null, 'approaching')).toBe(true)
    expect(Svc.isNewStage(null, 'overdue')).toBe(true)
    expect(Svc.isNewStage('approaching', 'approaching')).toBe(false)
    expect(Svc.isNewStage('approaching', 'overdue')).toBe(true)
    expect(Svc.isNewStage('overdue', 'overdue')).toBe(false)
    expect(Svc.isNewStage('overdue', 'approaching')).toBe(false)
  })
})

describe('DeviationInvestigationReminderService.scan() — idempotency', () => {
  function build(initialStage: string | null, dueAt: Date) {
    const deviation = {
      id: 'dev-1',
      companyId: 'company-1',
      deviationNumber: 'DEV-2026-00001',
      title: 'Seal failure',
      status: 'investigating',
      investigationDueAt: dueAt,
      investigationReminderStage: initialStage,
      raisedBy: 'raiser',
      investigation: { investigatorUserId: 'investigator' },
    }
    const update = jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      Object.assign(deviation, data)
      return Promise.resolve(deviation)
    })
    const tx = {
      deviation: { findMany: jest.fn().mockResolvedValue([deviation]), update },
      user: { findUnique: jest.fn().mockResolvedValue({ email: 'inv@x.test' }) },
      role: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const rls = {
      runWithSystemAccess: (fn: (t: typeof tx) => unknown) => fn(tx),
      runAsCompany: (_c: string, fn: (t: typeof tx) => unknown) => fn(tx),
    }
    const auditLog = jest.fn().mockResolvedValue(undefined)
    const notificationsCreate = jest.fn().mockResolvedValue({})
    const service = new Svc(
      rls as never,
      { log: auditLog } as never,
      { create: notificationsCreate } as never,
    )
    return { service, deviation, auditLog, notificationsCreate }
  }

  it('sends the approaching reminder once, records the stage, and audits it', async () => {
    const now = new Date('2026-10-18T00:00:00Z')
    const { service, deviation, auditLog, notificationsCreate } = build(
      null,
      new Date('2026-10-20T00:00:00Z'),
    )
    const first = await service.scan(now)
    expect(first.remindersSent).toBe(1)
    expect(deviation.investigationReminderStage).toBe('approaching')
    expect(notificationsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'investigator', category: 'deadline_approaching' }),
    )
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'deviation_investigation_reminder_sent' }),
    )

    // Same day, run again: no repeat.
    const second = await service.scan(now)
    expect(second.remindersSent).toBe(0)
    expect(notificationsCreate).toHaveBeenCalledTimes(1)
  })

  it('escalates to the overdue reminder once, after an approaching one', async () => {
    const { service, deviation, notificationsCreate } = build(
      'approaching',
      new Date('2026-10-20T00:00:00Z'),
    )
    const result = await service.scan(new Date('2026-10-21T00:00:00Z'))
    expect(result.remindersSent).toBe(1)
    expect(deviation.investigationReminderStage).toBe('overdue')
    expect(notificationsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'deadline_breached' }),
    )
  })

  it('never re-sends an overdue reminder', async () => {
    const { service, notificationsCreate } = build('overdue', new Date('2026-10-20T00:00:00Z'))
    const result = await service.scan(new Date('2026-10-25T00:00:00Z'))
    expect(result.remindersSent).toBe(0)
    expect(notificationsCreate).not.toHaveBeenCalled()
  })
})
