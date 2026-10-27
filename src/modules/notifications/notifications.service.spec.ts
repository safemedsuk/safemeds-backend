import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { NotificationsService } from './notifications.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

interface NotificationRow {
  id: string
  companyId: string
  userId: string
  category: string
  title: string
  readAt: Date | null
  createdAt: string
}
type CreateNotificationData = Omit<NotificationRow, 'id' | 'readAt'> & { id?: string }

function buildHarness() {
  const notifications = new Map<string, NotificationRow>()
  let seq = 0

  const notificationCreate = jest
    .fn()
    .mockImplementation(({ data }: { data: CreateNotificationData }) => {
      const row: NotificationRow = { readAt: null, ...data, id: data.id ?? `n-${seq++}` }
      notifications.set(row.id, row)
      return Promise.resolve(row)
    })
  const notificationFindMany = jest
    .fn()
    .mockImplementation(
      ({
        where,
        take,
      }: {
        where: { companyId: string; userId: string; readAt?: null }
        take: number
      }) => {
        let rows = [...notifications.values()].filter(
          (n) => n.companyId === where.companyId && n.userId === where.userId,
        )
        if (where.readAt === null) rows = rows.filter((n) => n.readAt === null)
        rows.sort((a, b) => (a.id < b.id ? 1 : -1))
        return Promise.resolve(rows.slice(0, take))
      },
    )
  const notificationFindFirst = jest
    .fn()
    .mockImplementation(
      ({ where }: { where: { id: string; companyId: string; userId: string } }) => {
        const n = notifications.get(where.id)
        return Promise.resolve(
          n && n.companyId === where.companyId && n.userId === where.userId ? n : null,
        )
      },
    )
  const notificationUpdate = jest
    .fn()
    .mockImplementation(
      ({ where, data }: { where: { id: string }; data: Partial<NotificationRow> }) => {
        const existing = notifications.get(where.id)!
        const updated = { ...existing, ...data }
        notifications.set(where.id, updated)
        return Promise.resolve(updated)
      },
    )
  const notificationCount = jest
    .fn()
    .mockImplementation(
      ({ where }: { where: { companyId: string; userId: string; readAt?: null } }) => {
        let rows = [...notifications.values()].filter(
          (n) => n.companyId === where.companyId && n.userId === where.userId,
        )
        if (where.readAt === null) rows = rows.filter((n) => n.readAt === null)
        return Promise.resolve(rows.length)
      },
    )

  const tables = {
    notification: {
      create: notificationCreate,
      findMany: notificationFindMany,
      findFirst: notificationFindFirst,
      update: notificationUpdate,
      count: notificationCount,
    },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const preferenceFindUnique = jest.fn().mockResolvedValue(null)
  const userFindUnique = jest.fn().mockResolvedValue({ preferredLocale: 'en' })
  const prisma = {
    notificationPreference: { findUnique: preferenceFindUnique },
    user: { findUnique: userFindUnique },
  }

  const emailAdd = jest.fn().mockResolvedValue(undefined)
  const emailQueue = { add: emailAdd }

  const service = new NotificationsService(rls as never, prisma as never, emailQueue as never)
  return {
    service,
    notifications,
    preferenceFindUnique,
    userFindUnique,
    emailAdd,
    notificationFindMany,
  }
}

describe('NotificationsService', () => {
  it('create() always writes the in-app row', async () => {
    const { service, notifications } = buildHarness()
    const created = await service.create({
      companyId: 'company-1',
      userId: 'user-1',
      category: 'task_assigned',
      title: 'You have a new task',
    })

    expect(notifications.get(created.id)).toBeDefined()
    expect(created.readAt).toBeNull()
  })

  it('create() with no preference row queues email for task_assigned/deadline (default on) but not workflow_update (default off)', async () => {
    const { service, emailAdd } = buildHarness()

    await service.create({
      companyId: 'company-1',
      userId: 'user-1',
      category: 'task_assigned',
      title: 'T',
      email: { to: 'a@b.com' },
    })
    expect(emailAdd).toHaveBeenCalledTimes(1)

    await service.create({
      companyId: 'company-1',
      userId: 'user-1',
      category: 'workflow_update',
      title: 'W',
      email: { to: 'a@b.com' },
    })
    expect(emailAdd).toHaveBeenCalledTimes(1) // still 1 — workflow_update defaults to off
  })

  it('create() respects an explicit preference row that disables a normally-on category', async () => {
    const { service, preferenceFindUnique, emailAdd } = buildHarness()
    preferenceFindUnique.mockResolvedValue({
      userId: 'user-1',
      emailTaskAssigned: false,
      emailDeadline: true,
      emailWorkflowUpdate: false,
    })

    await service.create({
      companyId: 'company-1',
      userId: 'user-1',
      category: 'task_assigned',
      title: 'T',
      email: { to: 'a@b.com' },
    })

    expect(emailAdd).not.toHaveBeenCalled()
  })

  it('create() queues the email job with recipientContext "account" — a real SafeMeds user', async () => {
    const { service, emailAdd } = buildHarness()
    await service.create({
      companyId: 'company-1',
      userId: 'user-1',
      category: 'task_assigned',
      title: 'T',
      email: { to: 'a@b.com' },
    })

    expect(emailAdd).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ recipientContext: 'account' }),
      expect.anything(),
    )
  })

  it('sendExternalEmail() queues the email job with recipientContext "external" — no SafeMeds account exists for this recipient', async () => {
    const { service, emailAdd } = buildHarness()
    await service.sendExternalEmail('reporter@example.com', 'Subject', 'Body text')

    expect(emailAdd).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ to: 'reporter@example.com', recipientContext: 'external' }),
      expect.anything(),
    )
  })

  it('create() without an email option never queues, regardless of preference', async () => {
    const { service, emailAdd } = buildHarness()
    await service.create({
      companyId: 'company-1',
      userId: 'user-1',
      category: 'task_assigned',
      title: 'T',
    })
    expect(emailAdd).not.toHaveBeenCalled()
  })

  it('markRead() sets readAt and unreadCount() reflects it', async () => {
    const { service } = buildHarness()
    const created = await service.create({
      companyId: 'company-1',
      userId: 'user-1',
      category: 'task_assigned',
      title: 'T',
    })

    expect(await service.unreadCount(actor)).toBe(1)
    const read = await service.markRead(actor, created.id)
    expect(read.readAt).not.toBeNull()
    expect(await service.unreadCount(actor)).toBe(0)
  })

  it('markRead() is idempotent — reading an already-read notification does not error', async () => {
    const { service } = buildHarness()
    const created = await service.create({
      companyId: 'company-1',
      userId: 'user-1',
      category: 'task_assigned',
      title: 'T',
    })
    await service.markRead(actor, created.id)
    await expect(service.markRead(actor, created.id)).resolves.toBeDefined()
  })

  it('list() queries newest-first (by id, UUID v7 is time-ordered) and returns both rows', async () => {
    // Two real newId() calls this close together can land in the same
    // millisecond, so their relative order isn't a reliable thing for a
    // *unit* test to assert on (that's a property of newId()/Postgres
    // sort behaviour, not of this service's logic) — assert the query
    // contract instead: it asks the DB for id-descending order, and it
    // returns everything the DB handed back.
    const { service, notificationFindMany } = buildHarness()
    await service.create({
      companyId: 'company-1',
      userId: 'user-1',
      category: 'task_assigned',
      title: 'First',
    })
    await service.create({
      companyId: 'company-1',
      userId: 'user-1',
      category: 'task_assigned',
      title: 'Second',
    })

    const { rows } = await service.list(actor, {})
    expect(rows.map((r) => r.title).sort()).toEqual(['First', 'Second'])
    expect(notificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { id: 'desc' } }),
    )
  })
})
