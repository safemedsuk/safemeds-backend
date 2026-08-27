import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { SafetyAlertService } from './safety-alert.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
  platformRole: null,
  tokenVersion: 1,
}
const noCompanyActor: AuthenticatedUser = {
  sub: 'user-2',
  companyId: null,
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

interface Row {
  id: string
  [key: string]: unknown
}

function createTable<T extends Row>(defaults: Partial<T> = {}) {
  const rows = new Map<string, T>()
  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) =>
      value === undefined ? true : row[key] === value,
    )
  }
  const create = jest.fn().mockImplementation(({ data }: { data: T }) => {
    rows.set(data.id, { ...defaults, ...data })
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
          list = [...list].sort(
            (a, b) =>
              (new Date(a[field] as string).getTime() - new Date(b[field] as string).getTime()) *
              (dir === 'desc' ? -1 : 1),
          )
        }
        return Promise.resolve(list)
      },
    )
  const count = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {})).length),
    )
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<T> }) => {
      const existing = rows.get(where.id)!
      const updated = { ...existing, ...data }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })
  return { rows, create, findFirst, findMany, count, update }
}

function buildHarness() {
  const tables = { safetyAlert: createTable({ status: 'open' }), product: createTable() }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new SafetyAlertService(rls as never, auditService)
  return { service, tables, auditLog }
}

describe('SafetyAlertService', () => {
  describe('create()', () => {
    it('logs a safety alert with no product reference', async () => {
      const { service, tables } = buildHarness()
      const alert = await service.create(
        actor,
        {
          title: 'Batch withdrawal notice',
          source: 'WHO Medical Product Alert',
          summary: 'A batch was recalled abroad.',
        },
        {},
      )
      expect(alert.status).toBe('open')
      expect(tables.safetyAlert.rows.size).toBe(1)
    })

    it('links a real product when affectedProductId is supplied', async () => {
      const { service, tables } = buildHarness()
      tables.product.rows.set('product-1', { id: 'product-1', companyId: 'company-1' })
      const alert = await service.create(
        actor,
        { title: 'x', source: 'y', summary: 'z', affectedProductId: 'product-1' },
        {},
      )
      expect(alert.affectedProductId).toBe('product-1')
    })

    it('404s on an unknown product reference', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(
          actor,
          { title: 'x', source: 'y', summary: 'z', affectedProductId: 'nonexistent' },
          {},
        ),
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(noCompanyActor, { title: 'x', source: 'y', summary: 'z' }, {}),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('updateStatus()', () => {
    it('moves an alert from open to reviewed with a note', async () => {
      const { service } = buildHarness()
      const alert = await service.create(actor, { title: 'x', source: 'y', summary: 'z' }, {})
      const updated = await service.updateStatus(
        actor,
        alert.id,
        { status: 'reviewed', reviewNote: 'Not relevant to our products.' },
        {},
      )
      expect(updated.status).toBe('reviewed')
      expect(updated.reviewNote).toBe('Not relevant to our products.')
    })

    it('keeps the existing note when a new one is not supplied', async () => {
      const { service } = buildHarness()
      const alert = await service.create(actor, { title: 'x', source: 'y', summary: 'z' }, {})
      await service.updateStatus(
        actor,
        alert.id,
        { status: 'reviewed', reviewNote: 'First note.' },
        {},
      )
      const dismissed = await service.updateStatus(actor, alert.id, { status: 'dismissed' }, {})
      expect(dismissed.reviewNote).toBe('First note.')
    })

    it('404s on an unknown alert', async () => {
      const { service } = buildHarness()
      await expect(
        service.updateStatus(actor, 'nonexistent', { status: 'reviewed' }, {}),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('list() / get()', () => {
    it('filters by status', async () => {
      const { service } = buildHarness()
      const a = await service.create(actor, { title: 'a', source: 'x', summary: 'z' }, {})
      await service.create(actor, { title: 'b', source: 'x', summary: 'z' }, {})
      await service.updateStatus(actor, a.id, { status: 'dismissed' }, {})

      const openOnly = await service.list(actor, 'open')
      expect(openOnly).toHaveLength(1)
      expect(openOnly[0].title).toBe('b')
    })

    it('get() 404s on an unknown id', async () => {
      const { service } = buildHarness()
      await expect(service.get(actor, 'nonexistent')).rejects.toThrow(NotFoundException)
    })
  })

  describe('countOpen()', () => {
    it('counts only open alerts', async () => {
      const { service } = buildHarness()
      const a = await service.create(actor, { title: 'a', source: 'x', summary: 'z' }, {})
      await service.create(actor, { title: 'b', source: 'x', summary: 'z' }, {})
      await service.updateStatus(actor, a.id, { status: 'actioned' }, {})

      await expect(service.countOpen('company-1')).resolves.toBe(1)
    })
  })
})
