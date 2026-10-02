import { DraftReviewReminderService } from './draft-review-reminder.service'

interface Draft {
  id: string
  companyId: string
  referenceNumber: string
  createdAt: Date
  draftClaimedBy: string | null
}

function buildHarness(drafts: Draft[]) {
  const auditFindFirst = jest.fn().mockResolvedValue(null)
  const roleFindMany = jest.fn().mockResolvedValue([{ key: 'SUPERINTENDENT_PHARMACIST' }])
  const userFindMany = jest.fn().mockResolvedValue([{ id: 'staff-1', email: 'staff@example.com' }])
  const userFindFirst = jest.fn().mockResolvedValue(null)

  const tables = {
    auditEntry: { findFirst: auditFindFirst },
    role: { findMany: roleFindMany },
    user: { findMany: userFindMany, findFirst: userFindFirst },
  }

  const rls = {
    runWithSystemAccess: (fn: (tx: { case: { findMany: jest.Mock } }) => unknown) =>
      fn({ case: { findMany: jest.fn().mockResolvedValue(drafts) } }),
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const notificationsCreate = jest.fn().mockResolvedValue(undefined)
  const notificationsService = { create: notificationsCreate } as never

  const service = new DraftReviewReminderService(rls as never, auditService, notificationsService)
  return { service, auditFindFirst, roleFindMany, userFindMany, userFindFirst, auditLog, notificationsCreate }
}

function draft(overrides: Partial<Draft> = {}): Draft {
  const old = new Date()
  old.setHours(old.getHours() - 25)
  return {
    id: 'case-1',
    companyId: 'company-1',
    referenceNumber: 'KEN-2026-KEN-00001',
    createdAt: old,
    draftClaimedBy: null,
    ...overrides,
  }
}

describe('DraftReviewReminderService (real-usage request, 22 Sep 2026, item 13)', () => {
  it('sends a reminder to every pv.triage_case-holding user when the draft is unclaimed and past 24h with no prior reminder', async () => {
    const { service, notificationsCreate, auditLog } = buildHarness([draft()])

    const result = await service.scanAndRemind()

    expect(result).toEqual({ draftsScanned: 1, remindersSent: 1 })
    expect(notificationsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'staff-1', category: 'draft_review', recordId: 'case-1' }),
    )
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'pv_case_draft_review_reminder_sent', recordId: 'case-1' }),
    )
  })

  it('does not remind a case created less than 24h ago with no prior reminder', async () => {
    const fresh = new Date()
    fresh.setHours(fresh.getHours() - 2)
    const { service, notificationsCreate } = buildHarness([draft({ createdAt: fresh })])

    const result = await service.scanAndRemind()
    expect(result.remindersSent).toBe(0)
    expect(notificationsCreate).not.toHaveBeenCalled()
  })

  it('does not remind again while the most recent reminder is still within the 24h window', async () => {
    const { service, auditFindFirst, notificationsCreate } = buildHarness([draft()])
    const recent = new Date()
    recent.setHours(recent.getHours() - 3)
    auditFindFirst.mockResolvedValue({ occurredAt: recent })

    const result = await service.scanAndRemind()
    expect(result.remindersSent).toBe(0)
    expect(notificationsCreate).not.toHaveBeenCalled()
  })

  it('reminds again once the most recent reminder is itself more than 24h old', async () => {
    const { service, auditFindFirst } = buildHarness([draft()])
    const stale = new Date()
    stale.setHours(stale.getHours() - 25)
    auditFindFirst.mockResolvedValue({ occurredAt: stale })

    const result = await service.scanAndRemind()
    expect(result.remindersSent).toBe(1)
  })

  it('notifies the specific claimant directly when the draft has already been claimed', async () => {
    const { service, notificationsCreate, userFindFirst, roleFindMany } = buildHarness([
      draft({ draftClaimedBy: 'user-claimant' }),
    ])
    userFindFirst.mockResolvedValue({ id: 'user-claimant', email: 'claimant@example.com' })

    await service.scanAndRemind()

    expect(notificationsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-claimant', category: 'draft_review' }),
    )
    expect(roleFindMany).not.toHaveBeenCalled() // never falls through to the role-queue fan-out
  })

  it('falls back to the role-queue fan-out if the claimant no longer exists/is inactive', async () => {
    const { service, notificationsCreate, userFindFirst } = buildHarness([
      draft({ draftClaimedBy: 'user-departed' }),
    ])
    userFindFirst.mockResolvedValue(null)

    await service.scanAndRemind()

    expect(notificationsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'staff-1', category: 'draft_review' }),
    )
  })

  it('scans zero drafts cleanly when none are pending', async () => {
    const { service } = buildHarness([])
    const result = await service.scanAndRemind()
    expect(result).toEqual({ draftsScanned: 0, remindersSent: 0 })
  })
})
