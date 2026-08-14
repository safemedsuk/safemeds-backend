import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ContactTestService } from './contact-test.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
  platformRole: null,
  tokenVersion: 1,
}
const platformActor: AuthenticatedUser = {
  sub: 'staff-1',
  companyId: null,
  roleKeys: [],
  platformRole: 'super_admin',
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
      if (
        value !== null &&
        typeof value === 'object' &&
        'lt' in (value as Record<string, unknown>)
      ) {
        return (row[key] as Date) < (value as { lt: Date }).lt
      }
      if (
        value !== null &&
        typeof value === 'object' &&
        'in' in (value as Record<string, unknown>)
      ) {
        return (value as { in: unknown[] }).in.includes(row[key])
      }
      return row[key] === value
    })
  }
  const create = jest.fn().mockImplementation(({ data }: { data: T }) => {
    // Mirrors the schema's own `occurredAt DateTime @default(now())` / `createdAt`/`updatedAt` defaults the real Prisma client would apply.
    rows.set(data.id, {
      occurredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    })
    return Promise.resolve(rows.get(data.id))
  })
  const findFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].find((r) => matches(r, where)) ?? null),
    )
  const findMany = jest
    .fn()
    .mockImplementation(
      ({
        where,
        orderBy,
      }: {
        where?: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'>
      }) => {
        let list = [...rows.values()].filter((r) => matches(r, where ?? {}))
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0]
          list = list.sort(
            (a, b) =>
              ((a[field] as Date).getTime() - (b[field] as Date).getTime()) *
              (dir === 'desc' ? -1 : 1),
          )
        }
        return Promise.resolve(list)
      },
    )
  const update = jest
    .fn()
    .mockImplementation(
      ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = rows.get(where.id)!
        const updated: Record<string, unknown> = { ...existing }
        for (const [key, value] of Object.entries(data)) {
          if (
            value !== null &&
            typeof value === 'object' &&
            'increment' in (value as Record<string, unknown>)
          ) {
            updated[key] = (Number(existing[key]) || 0) + (value as { increment: number }).increment
          } else {
            updated[key] = value
          }
        }
        rows.set(where.id, updated as T)
        return Promise.resolve(updated)
      },
    )
  return { rows, create, findFirst, findMany, update }
}

function buildHarness() {
  const tables = { contactTest: createTable(), contactTestAttempt: createTable() }

  // `get()` fetches a test with `include: { attempts: { orderBy: ... } } }` —
  // the generic `createTable()` mock has no join support, so this wraps
  // `contactTest.findFirst` to hydrate `attempts` itself whenever `include`
  // is passed, mirroring what Prisma would actually return.
  const baseFindFirst = tables.contactTest.findFirst
  tables.contactTest.findFirst = jest
    .fn()
    .mockImplementation(
      async (args: { where: Record<string, unknown>; include?: { attempts?: unknown } }) => {
        const found = (await baseFindFirst(args)) as Row | null
        if (!found || !args.include?.attempts) return found
        const attempts = (await tables.contactTestAttempt.findMany({
          where: { contactTestId: found.id },
          orderBy: { occurredAt: 'asc' },
        })) as unknown[]
        return { ...found, attempts }
      },
    ) as never
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const sendExternalEmail = jest.fn().mockResolvedValue(undefined)
  const notificationsService = { sendExternalEmail } as never

  const service = new ContactTestService(rls as never, auditService, notificationsService)
  return { service, tables, auditLog, sendExternalEmail }
}

describe('ContactTestService', () => {
  describe('start()', () => {
    it('starts an email test with a 5-calendar-day window and sends a real test email', async () => {
      const { service, tables, sendExternalEmail } = buildHarness()
      const before = Date.now()
      const test = await service.start(
        actor,
        { channel: 'email', contactValue: 'safety@acme.com', purpose: 'Drug safety mailbox' },
        {},
      )

      expect(test.status).toBe('pending_attempt_1')
      expect(test.channel).toBe('email')
      const windowMs = test.windowDueAt.getTime() - before
      expect(windowMs).toBeGreaterThan(4.9 * 24 * 60 * 60 * 1000)
      expect(windowMs).toBeLessThan(5.1 * 24 * 60 * 60 * 1000)
      expect(sendExternalEmail).toHaveBeenCalledWith(
        'safety@acme.com',
        expect.stringContaining('reachability'),
        expect.any(String),
      )
      expect(tables.contactTest.rows.size).toBe(1)
    })

    it('starts a phone test with an immediate window and never sends an email', async () => {
      const { service, sendExternalEmail } = buildHarness()
      const before = Date.now()
      const test = await service.start(
        actor,
        { channel: 'phone', contactValue: '+254700000000', purpose: 'QPPV after-hours hotline' },
        {},
      )

      expect(test.windowDueAt.getTime()).toBeGreaterThanOrEqual(before)
      expect(test.windowDueAt.getTime()).toBeLessThan(before + 5000)
      expect(sendExternalEmail).not.toHaveBeenCalled()
    })

    it('rejects a platform-staff actor with no company', async () => {
      const { service } = buildHarness()
      await expect(
        service.start(platformActor, { channel: 'phone', contactValue: '+254700000000' }, {}),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('logAttempt() — two-trigger retry state machine', () => {
    it('an outcome of "reached" on attempt 1 closes the test immediately ("good and dusted")', async () => {
      const { service, auditLog } = buildHarness()
      const test = await service.start(
        actor,
        { channel: 'phone', contactValue: '+254700000000' },
        {},
      )

      const result = await service.logAttempt(actor, test.id, { outcome: 'reached' }, {})
      expect(result.status).toBe('reached')
      expect(result.attemptCount).toBe(1)
      expect(result.resolvedAt).not.toBeNull()
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'contact_test_attempt_logged',
          newValue: expect.objectContaining({ attemptNumber: 1, outcome: 'reached' }),
        }),
      )
    })

    it('no_response on attempt 1 moves to pending_attempt_2 with a fresh window, not resolved', async () => {
      const { service } = buildHarness()
      const test = await service.start(
        actor,
        { channel: 'phone', contactValue: '+254700000000' },
        {},
      )

      const result = await service.logAttempt(actor, test.id, { outcome: 'no_response' }, {})
      expect(result.status).toBe('pending_attempt_2')
      expect(result.attemptCount).toBe(1)
      expect(result.resolvedAt).toBeNull()
    })

    it('no_response on attempt 2 closes the test as unsuccessful ("rejected")', async () => {
      const { service } = buildHarness()
      const test = await service.start(
        actor,
        { channel: 'phone', contactValue: '+254700000000' },
        {},
      )
      await service.logAttempt(actor, test.id, { outcome: 'no_response' }, {})

      const result = await service.logAttempt(actor, test.id, { outcome: 'no_response' }, {})
      expect(result.status).toBe('unsuccessful')
      expect(result.attemptCount).toBe(2)
      expect(result.resolvedAt).not.toBeNull()
    })

    it('"reached" on attempt 2 still closes as reached, not unsuccessful', async () => {
      const { service } = buildHarness()
      const test = await service.start(
        actor,
        { channel: 'phone', contactValue: '+254700000000' },
        {},
      )
      await service.logAttempt(actor, test.id, { outcome: 'no_response' }, {})

      const result = await service.logAttempt(actor, test.id, { outcome: 'reached' }, {})
      expect(result.status).toBe('reached')
    })

    it('rejects logging an attempt against an already-resolved test', async () => {
      const { service } = buildHarness()
      const test = await service.start(
        actor,
        { channel: 'phone', contactValue: '+254700000000' },
        {},
      )
      await service.logAttempt(actor, test.id, { outcome: 'reached' }, {})

      await expect(service.logAttempt(actor, test.id, { outcome: 'reached' }, {})).rejects.toThrow(
        ConflictException,
      )
    })

    it('404s for a test that does not exist in this company', async () => {
      const { service } = buildHarness()
      await expect(
        service.logAttempt(actor, 'not-a-real-test', { outcome: 'reached' }, {}),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('processDue() — the daily sweep', () => {
    it('treats a test whose window has elapsed with nothing logged as a system-detected no_response', async () => {
      const { service, tables } = buildHarness()
      const test = await service.start(
        actor,
        { channel: 'email', contactValue: 'safety@acme.com' },
        {},
      )
      // Force the window into the past, simulating five days having elapsed with no reply.
      tables.contactTest.rows.set(test.id, {
        ...tables.contactTest.rows.get(test.id)!,
        windowDueAt: new Date(Date.now() - 1000),
      })

      const result = await service.processDue()
      expect(result.scanned).toBe(1)
      expect(result.settled).toBe(1)

      const updated = await service.get(actor, test.id)
      expect(updated.status).toBe('pending_attempt_2')
      expect(updated.attempts).toHaveLength(1)
      expect(updated.attempts[0].loggedBy).toBeNull()
      expect(updated.attempts[0].outcome).toBe('no_response')
    })

    it('does not touch a test whose window has not yet elapsed', async () => {
      const { service } = buildHarness()
      await service.start(actor, { channel: 'email', contactValue: 'safety@acme.com' }, {})

      const result = await service.processDue()
      expect(result.scanned).toBe(0)
      expect(result.settled).toBe(0)
    })

    it('never touches an already-resolved test', async () => {
      const { service, tables } = buildHarness()
      const test = await service.start(
        actor,
        { channel: 'phone', contactValue: '+254700000000' },
        {},
      )
      await service.logAttempt(actor, test.id, { outcome: 'reached' }, {})
      tables.contactTest.rows.set(test.id, {
        ...tables.contactTest.rows.get(test.id)!,
        windowDueAt: new Date(Date.now() - 1000),
      })

      const result = await service.processDue()
      expect(result.scanned).toBe(0)
    })
  })

  describe('get()', () => {
    it('returns attempts in chronological order', async () => {
      const { service } = buildHarness()
      const test = await service.start(
        actor,
        { channel: 'phone', contactValue: '+254700000000' },
        {},
      )
      await service.logAttempt(actor, test.id, { outcome: 'no_response' }, {})
      await service.logAttempt(actor, test.id, { outcome: 'reached' }, {})

      const found = await service.get(actor, test.id)
      expect(found.attempts.map((a) => a.attemptNumber)).toEqual([1, 2])
    })
  })
})
