import { ConflictException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CaseFollowUpService } from './case-follow-up.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['SUPERINTENDENT_PHARMACIST'],
  platformRole: null,
  tokenVersion: 1,
}

interface Row {
  id: string
  [key: string]: unknown
}

function createTable<T extends Row>() {
  const rows = new Map<string, T>()

  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true
      if (key === 'OR')
        return (value as Record<string, unknown>[]).some((clause) => matches(row, clause))
      if (
        value !== null &&
        typeof value === 'object' &&
        'in' in (value as Record<string, unknown>)
      ) {
        return (value as { in: unknown[] }).in.includes(row[key])
      }
      if (
        value !== null &&
        typeof value === 'object' &&
        'hasSome' in (value as Record<string, unknown>)
      ) {
        const arr = (row[key] as unknown[]) ?? []
        return (value as { hasSome: unknown[] }).hasSome.some((v) => arr.includes(v))
      }
      if (
        value !== null &&
        typeof value === 'object' &&
        'lte' in (value as Record<string, unknown>)
      ) {
        return (row[key] as Date) <= (value as { lte: Date }).lte
      }
      if (
        value !== null &&
        typeof value === 'object' &&
        'startsWith' in (value as Record<string, unknown>)
      ) {
        return (
          typeof row[key] === 'string' &&
          row[key].startsWith((value as { startsWith: string }).startsWith)
        )
      }
      return row[key] === value
    })
  }

  function createImpl({ data }: { data: T }): Promise<T> {
    const row = { ...data }
    rows.set(row.id, row)
    return Promise.resolve(row)
  }
  function findFirstImpl({ where }: { where: Record<string, unknown> }): Promise<T | null> {
    return Promise.resolve([...rows.values()].find((r) => matches(r, where)) ?? null)
  }
  async function findFirstOrThrowImpl(args: { where: Record<string, unknown> }): Promise<T> {
    const found = await findFirstImpl(args)
    if (!found) throw new Error('not found')
    return found
  }
  function findUniqueImpl({ where }: { where: Record<string, unknown> }): Promise<T | null> {
    return Promise.resolve([...rows.values()].find((r) => matches(r, where)) ?? null)
  }
  async function findUniqueOrThrowImpl(args: { where: Record<string, unknown> }): Promise<T> {
    const found = await findUniqueImpl(args)
    if (!found) throw new Error('not found')
    return found
  }
  function findManyImpl({ where }: { where?: Record<string, unknown> }): Promise<T[]> {
    return Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {})))
  }
  function updateImpl({ where, data }: { where: { id: string }; data: Partial<T> }): Promise<T> {
    const existing = rows.get(where.id)!
    const updated = { ...existing, ...data }
    rows.set(where.id, updated)
    return Promise.resolve(updated)
  }

  const create = jest.fn(createImpl)
  const findFirst = jest.fn(findFirstImpl)
  const findFirstOrThrow = jest.fn(findFirstOrThrowImpl)
  const findUnique = jest.fn(findUniqueImpl)
  const findUniqueOrThrow = jest.fn(findUniqueOrThrowImpl)
  const findMany = jest.fn(findManyImpl)
  const update = jest.fn(updateImpl)

  return {
    rows,
    create,
    findFirst,
    findFirstOrThrow,
    findUnique,
    findUniqueOrThrow,
    findMany,
    update,
  }
}

function buildHarness(opts: { consentGranted?: boolean; triageRoleKeys?: string[] } = {}) {
  const tables = {
    case: createTable(),
    reporter: createTable(),
    caseFollowUp: createTable(),
    caseFollowUpAttempt: createTable(),
    pregnancyContext: createTable(),
    role: createTable(),
    user: createTable(),
    company: createTable(),
    task: createTable(),
  }

  tables.company.rows.set('company-1', { id: 'company-1', status: 'active' })
  for (const key of opts.triageRoleKeys ?? ['SUPERINTENDENT_PHARMACIST']) {
    tables.role.rows.set(`role-${key}`, { id: `role-${key}`, key })
    tables.user.rows.set(`staff-${key}`, {
      id: `staff-${key}`,
      companyId: 'company-1',
      email: `${key}@example.com`,
      roleKeys: [key],
      status: 'active',
    })
  }
  // The real `tx.role.findMany()` filters via a nested `permissions.some.permission.key`
  // clause the generic in-memory `matches()` helper can't replicate — this mock
  // stands in for "every role granting pv.triage_case," which is exactly what's seeded above.
  tables.role.findMany = jest.fn().mockResolvedValue([...tables.role.rows.values()]) as never

  const baseCaseFollowUpFindUnique = tables.caseFollowUp.findUnique
  async function caseFollowUpFindUniqueImpl(args: {
    where: Record<string, unknown>
    include?: Record<string, boolean>
  }): Promise<Row | null> {
    const found = await baseCaseFollowUpFindUnique(args)
    if (!found || !args.include?.attempts) return found
    return {
      ...found,
      attempts: [...tables.caseFollowUpAttempt.rows.values()].filter(
        (a) => a.followUpId === found.id,
      ),
    }
  }
  tables.caseFollowUp.findUnique = jest.fn(caseFollowUpFindUniqueImpl) as never

  const baseCaseFollowUpFindFirst = tables.caseFollowUp.findFirst
  async function caseFollowUpFindFirstImpl(args: {
    where: Record<string, unknown>
    include?: Record<string, boolean>
  }): Promise<Row | null> {
    const found = await baseCaseFollowUpFindFirst(args)
    if (!found || !args.include?.attempts) return found
    return {
      ...found,
      attempts: [...tables.caseFollowUpAttempt.rows.values()].filter(
        (a) => a.followUpId === found.id,
      ),
    }
  }
  tables.caseFollowUp.findFirst = jest.fn(caseFollowUpFindFirstImpl) as never

  const baseCaseFollowUpFindUniqueOrThrow = tables.caseFollowUp.findUniqueOrThrow
  async function caseFollowUpFindUniqueOrThrowImpl(args: {
    where: Record<string, unknown>
    include?: Record<string, boolean>
  }): Promise<Row> {
    const found = await baseCaseFollowUpFindUniqueOrThrow(args)
    if (!args.include?.attempts) return found
    return {
      ...found,
      attempts: [...tables.caseFollowUpAttempt.rows.values()].filter(
        (a) => a.followUpId === found.id,
      ),
    }
  }
  tables.caseFollowUp.findUniqueOrThrow = jest.fn(caseFollowUpFindUniqueOrThrowImpl) as never

  const baseCaseFollowUpFindMany = tables.caseFollowUp.findMany
  async function caseFollowUpFindManyImpl(args: {
    where?: Record<string, unknown>
    include?: Record<string, boolean>
  }): Promise<Row[]> {
    const found = await baseCaseFollowUpFindMany(args)
    if (!args.include?.attempts) return found
    return found.map((f) => ({
      ...f,
      attempts: [...tables.caseFollowUpAttempt.rows.values()].filter((a) => a.followUpId === f.id),
    }))
  }
  tables.caseFollowUp.findMany = jest.fn(caseFollowUpFindManyImpl) as never

  const baseCaseFindFirst = tables.case.findFirst
  async function caseFindFirstImpl(args: {
    where: Record<string, unknown>
    include?: Record<string, boolean>
  }): Promise<Row | null> {
    const found = await baseCaseFindFirst(args)
    if (!found || !args.include?.reporter) return found
    return {
      ...found,
      reporter: [...tables.reporter.rows.values()].find((r) => r.caseId === found.id) ?? null,
    }
  }
  tables.case.findFirst = jest.fn(caseFindFirstImpl) as never

  const baseCaseFindFirstOrThrow = tables.case.findFirstOrThrow
  async function caseFindFirstOrThrowImpl(args: {
    where: Record<string, unknown>
    include?: Record<string, boolean>
  }): Promise<Row> {
    const found = await baseCaseFindFirstOrThrow(args)
    if (!args.include?.reporter) return found
    return {
      ...found,
      reporter: [...tables.reporter.rows.values()].find((r) => r.caseId === found.id) ?? null,
    }
  }
  tables.case.findFirstOrThrow = jest.fn(caseFindFirstOrThrowImpl) as never

  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const textEncryption = {
    encrypt: jest.fn((plaintext: string) => `enc(${plaintext})`),
    decrypt: jest.fn((ciphertext: string) => ciphertext.replace(/^enc\(/, '').replace(/\)$/, '')),
  } as never
  const checkSystem = jest
    .fn()
    .mockResolvedValue({
      hasRecord: opts.consentGranted !== undefined,
      granted: opts.consentGranted ?? false,
      record: null,
    })
  const consentService = { checkSystem } as never
  const sendExternalEmail = jest.fn().mockResolvedValue(undefined)
  const notificationsCreate = jest.fn().mockResolvedValue({ id: 'notification-1' })
  const notificationsService = { sendExternalEmail, create: notificationsCreate } as never
  const configService = { get: jest.fn().mockReturnValue('http://localhost:3000') } as never

  // Stage 11.1 — a lightweight stand-in for `TasksService.createForWorkflowState()`,
  // writing directly into the same in-memory `task` table so tests can
  // inspect the real due-list task it opens.
  let taskCounter = 0
  const createForWorkflowState = jest
    .fn()
    .mockImplementation(
      (input: {
        companyId: string
        recordType: string
        recordId: string
        title: string
        assignedRoleKey?: string
        assignedUserId?: string
      }) => {
        taskCounter += 1
        const row = { id: `task-${taskCounter}`, status: 'open', closedAt: null, ...input }
        tables.task.rows.set(row.id, row)
        return Promise.resolve(row)
      },
    )
  const tasksService = { createForWorkflowState } as never

  const service = new CaseFollowUpService(
    rls as never,
    auditService,
    consentService,
    notificationsService,
    tasksService,
    textEncryption,
    configService,
  )
  return {
    service,
    tables,
    auditLog,
    sendExternalEmail,
    notificationsCreate,
    createForWorkflowState,
  }
}

function seedCase(
  tables: ReturnType<typeof buildHarness>['tables'],
  overrides: Record<string, unknown> = {},
) {
  const id = (overrides.id as string) ?? 'case-1'
  tables.case.rows.set(id, {
    id,
    companyId: 'company-1',
    referenceNumber: `PV-2026-${id}`,
    ...overrides,
  })
  if (overrides.email !== null) {
    tables.reporter.rows.set(`reporter-${id}`, {
      id: `reporter-${id}`,
      caseId: id,
      companyId: 'company-1',
      email: overrides.email ?? 'reporter@example.com',
    })
  }
  return tables.case.rows.get(id) as Row
}

describe('CaseFollowUpService', () => {
  describe('start()', () => {
    it('with consent + a reporter email: opens an email attempt and emails the reporter directly', async () => {
      const { service, tables, sendExternalEmail, notificationsCreate } = buildHarness({
        consentGranted: true,
      })
      seedCase(tables)

      const followUp = await service.start(actor, 'case-1', {})

      expect(followUp.status).toBe('pending_attempt_1')
      expect(followUp.attempts).toHaveLength(1)
      expect(followUp.attempts[0].channel).toBe('email')
      expect(followUp.attempts[0].outcome).toBe('pending')
      expect(sendExternalEmail).toHaveBeenCalledWith(
        'reporter@example.com',
        expect.any(String),
        expect.any(String),
      )
      expect(notificationsCreate).toHaveBeenCalled() // staff also informed
    })

    it('without consent: opens a phone-channel attempt instead, never emails the reporter', async () => {
      const { service, tables, sendExternalEmail } = buildHarness({ consentGranted: false })
      seedCase(tables)

      const followUp = await service.start(actor, 'case-1', {})

      expect(followUp.attempts[0].channel).toBe('phone')
      expect(sendExternalEmail).not.toHaveBeenCalled()
    })

    it('is idempotent — a second start() on the same case returns the existing cycle, does not open a second attempt', async () => {
      const { service, tables } = buildHarness({ consentGranted: true })
      seedCase(tables)

      const first = await service.start(actor, 'case-1', {})
      const second = await service.start(actor, 'case-1', {})

      expect(second.id).toBe(first.id)
      expect(tables.caseFollowUpAttempt.rows.size).toBe(1)
    })

    it('sets a 28-calendar-day hard ceiling from the start time', async () => {
      const { service, tables } = buildHarness({ consentGranted: true })
      seedCase(tables)
      const before = Date.now()

      const followUp = await service.start(actor, 'case-1', {})

      const days = (followUp.closesByDate.getTime() - before) / (24 * 60 * 60 * 1000)
      expect(days).toBeGreaterThan(27.9)
      expect(days).toBeLessThan(28.1)
    })
  })

  describe('Stage 11.1 — handler resolution, reporter contact, and due-list tasks', () => {
    it("notifies only the case's own captor when Case.createdBy is set — not the full role-based fan-out", async () => {
      const { service, tables, notificationsCreate } = buildHarness({ consentGranted: true })
      seedCase(tables, { createdBy: 'captor-1' })
      tables.user.rows.set('captor-1', {
        id: 'captor-1',
        companyId: 'company-1',
        email: 'captor@example.com',
        roleKeys: ['DISPENSING_PHARMACIST'],
        status: 'active',
      })

      await service.start(actor, 'case-1', {})

      expect(notificationsCreate).toHaveBeenCalledTimes(1)
      expect(notificationsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'captor-1' }),
      )
    })

    it('falls back to the role-based fan-out for a system-channel case with no captor', async () => {
      const { service, tables, notificationsCreate } = buildHarness({
        consentGranted: true,
        triageRoleKeys: ['SUPERINTENDENT_PHARMACIST', 'QPPV'],
      })
      seedCase(tables) // no createdBy — matches a public-URL/WhatsApp/email-sourced case

      await service.start(actor, 'case-1', {})

      expect(notificationsCreate).toHaveBeenCalledTimes(2)
      expect(notificationsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'staff-SUPERINTENDENT_PHARMACIST' }),
      )
      expect(notificationsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'staff-QPPV' }),
      )
    })

    it("falls back to the role-based fan-out when the captor's account has since been deactivated", async () => {
      const { service, tables, notificationsCreate } = buildHarness({ consentGranted: true })
      seedCase(tables, { createdBy: 'captor-1' })
      tables.user.rows.set('captor-1', {
        id: 'captor-1',
        companyId: 'company-1',
        email: 'captor@example.com',
        roleKeys: ['DISPENSING_PHARMACIST'],
        status: 'deactivated',
      })

      await service.start(actor, 'case-1', {})

      expect(notificationsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'staff-SUPERINTENDENT_PHARMACIST' }),
      )
    })

    it("includes the reporter's own name/phone/email in the notification body", async () => {
      const { service, tables, notificationsCreate } = buildHarness({ consentGranted: true })
      seedCase(tables)
      tables.reporter.rows.set('reporter-case-1', {
        id: 'reporter-case-1',
        caseId: 'case-1',
        companyId: 'company-1',
        email: 'reporter@example.com',
        fullName: 'Jane Doe',
        phone: '0700000000',
      })

      await service.start(actor, 'case-1', {})

      expect(notificationsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('Jane Doe · 0700000000 · reporter@example.com'),
        }),
      )
    })

    it('says so plainly when the reporter has no contact details on file at all', async () => {
      const { service, tables, notificationsCreate } = buildHarness({ consentGranted: false })
      seedCase(tables, { email: null })

      await service.start(actor, 'case-1', {})

      expect(notificationsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('no reporter contact details on file'),
        }),
      )
    })

    it('opens a real due-list Task on trigger, and closes it once the cycle resolves', async () => {
      const { service, tables, createForWorkflowState } = buildHarness({ consentGranted: true })
      seedCase(tables)

      const followUp = await service.start(actor, 'case-1', {})
      expect(createForWorkflowState).toHaveBeenCalledTimes(1)
      const openTasks = [...tables.task.rows.values()].filter((t) => t.status === 'open')
      expect(openTasks).toHaveLength(1)
      expect(openTasks[0].title).toContain('Follow-up 1')
      expect(openTasks[0].assignedRoleKey).toBe('SUPERINTENDENT_PHARMACIST')

      await service.logAttempt(actor, followUp.id, { outcome: 'responded_resolved' }, {})

      const stillOpen = [...tables.task.rows.values()].filter((t) => t.status === 'open')
      expect(stillOpen).toHaveLength(0)
    })

    it('replaces the due-list Task (not duplicates it) when an attempt escalates from 1 to 2', async () => {
      const { service, tables } = buildHarness({ consentGranted: true })
      seedCase(tables)
      const followUp = await service.start(actor, 'case-1', {})

      await service.logAttempt(actor, followUp.id, { outcome: 'no_response' }, {})

      const openTasks = [...tables.task.rows.values()].filter((t) => t.status === 'open')
      expect(openTasks).toHaveLength(1)
      expect(openTasks[0].title).toContain('Follow-up 2')
    })

    it('replaces the due-list Task with a fresh due date on a new-information reset', async () => {
      const { service, tables } = buildHarness({ consentGranted: true })
      seedCase(tables)
      const followUp = await service.start(actor, 'case-1', {})

      await service.logAttempt(actor, followUp.id, { outcome: 'responded_new_information' }, {})

      const openTasks = [...tables.task.rows.values()].filter((t) => t.status === 'open')
      expect(openTasks).toHaveLength(1)
      expect(openTasks[0].title).toContain('new information received')
    })
  })

  describe('logAttempt()', () => {
    it('responded_resolved closes the cycle immediately', async () => {
      const { service, tables } = buildHarness({ consentGranted: true })
      seedCase(tables)
      const followUp = await service.start(actor, 'case-1', {})

      const result = await service.logAttempt(
        actor,
        followUp.id,
        { outcome: 'responded_resolved', note: 'Reporter confirmed full recovery' },
        {},
      )

      expect(result.status).toBe('closed_resolved')
      expect(result.attempts[0].outcome).toBe('responded_resolved')
      expect(result.attempts[0].note).toBe('Reporter confirmed full recovery')
    })

    it('responded_new_information resets a 7-day check window without closing', async () => {
      const { service, tables } = buildHarness({ consentGranted: true })
      seedCase(tables)
      const followUp = await service.start(actor, 'case-1', {})
      const before = Date.now()

      const result = await service.logAttempt(
        actor,
        followUp.id,
        { outcome: 'responded_new_information' },
        {},
      )

      expect(result.status).toBe('pending_attempt_1') // still open — new info resets, doesn't close
      const days = (result.nextCheckDueAt!.getTime() - before) / (24 * 60 * 60 * 1000)
      expect(days).toBeGreaterThan(6.9)
      expect(days).toBeLessThan(7.1)

      // Real bug found browser-verifying this stage: after a new-information
      // log, the same attempt row must still be loggable again — it was
      // left in a terminal state with nothing "pending" to attach a second
      // log to, even though the cycle was obviously still open.
      expect(result.attempts).toHaveLength(1)
      expect(result.attempts[0].outcome).toBe('pending')

      const secondLog = await service.logAttempt(
        actor,
        followUp.id,
        { outcome: 'responded_resolved' },
        {},
      )
      expect(secondLog.status).toBe('closed_resolved')
    })

    it('no_response on attempt 1 escalates to attempt 2, opening a new attempt', async () => {
      const { service, tables } = buildHarness({ consentGranted: true })
      seedCase(tables)
      const followUp = await service.start(actor, 'case-1', {})

      const result = await service.logAttempt(actor, followUp.id, { outcome: 'no_response' }, {})

      expect(result.status).toBe('pending_attempt_2')
      expect(result.attempts).toHaveLength(2)
      expect(result.attempts[1].attemptNumber).toBe(2)
      expect(result.attempts[1].outcome).toBe('pending')
    })

    it('no_response on attempt 2 closes the cycle as failed', async () => {
      const { service, tables } = buildHarness({ consentGranted: true })
      seedCase(tables)
      const followUp = await service.start(actor, 'case-1', {})
      await service.logAttempt(actor, followUp.id, { outcome: 'no_response' }, {}) // → attempt 2

      const result = await service.logAttempt(actor, followUp.id, { outcome: 'no_response' }, {})

      expect(result.status).toBe('closed_failed')
      expect(result.closedReason).toContain('2 attempts')
    })

    it('rejects logging against an already-closed cycle', async () => {
      const { service, tables } = buildHarness({ consentGranted: true })
      seedCase(tables)
      const followUp = await service.start(actor, 'case-1', {})
      await service.logAttempt(actor, followUp.id, { outcome: 'responded_resolved' }, {})

      await expect(
        service.logAttempt(actor, followUp.id, { outcome: 'no_response' }, {}),
      ).rejects.toThrow(ConflictException)
    })

    it('404s for a follow-up that does not exist', async () => {
      const { service } = buildHarness()
      await expect(
        service.logAttempt(actor, 'missing', { outcome: 'no_response' }, {}),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('processDue()', () => {
    it('treats a past-due pending attempt as no_response and escalates it', async () => {
      const { service, tables } = buildHarness({ consentGranted: true })
      seedCase(tables)
      const followUp = await service.start(actor, 'case-1', {})
      // Force the open attempt's dueAt into the past.
      const attempt = [...tables.caseFollowUpAttempt.rows.values()][0]
      tables.caseFollowUpAttempt.rows.set(attempt.id, {
        ...attempt,
        dueAt: new Date(Date.now() - 1000),
      })

      const result = await service.processDue()

      expect(result.attemptsTimedOut).toBe(1)
      const refreshed = tables.caseFollowUp.rows.get(followUp.id) as Row
      expect(refreshed.status).toBe('pending_attempt_2')
    })

    it('force-closes any open cycle past its 28-day closesByDate, regardless of attempt state', async () => {
      const { service, tables } = buildHarness({ consentGranted: true })
      seedCase(tables)
      const followUp = await service.start(actor, 'case-1', {})
      const stored = tables.caseFollowUp.rows.get(followUp.id) as Row
      tables.caseFollowUp.rows.set(followUp.id, {
        ...stored,
        closesByDate: new Date(Date.now() - 1000),
      })

      const result = await service.processDue()

      expect(result.hardClosed).toBe(1)
      const refreshed = tables.caseFollowUp.rows.get(followUp.id) as Row
      expect(refreshed.status).toBe('closed_failed')
      expect(refreshed.closedReason).toContain('28-day')
    })

    it('auto-starts a follow-up for a case whose pregnancy followUpDueAt has come due', async () => {
      const { service, tables } = buildHarness({ consentGranted: true })
      seedCase(tables, { id: 'case-preg' })
      tables.pregnancyContext.rows.set('preg-1', {
        id: 'preg-1',
        companyId: 'company-1',
        caseId: 'case-preg',
        followUpDueAt: new Date(Date.now() - 1000),
      })

      const result = await service.processDue()

      expect(result.pregnancyTriggered).toBe(1)
      expect(tables.caseFollowUp.findFirst).toBeDefined()
      const started = [...tables.caseFollowUp.rows.values()].find((f) => f.caseId === 'case-preg')
      expect(started).toBeDefined()
      expect((started as Row).startedBy).toBeNull()
    })
  })
})
