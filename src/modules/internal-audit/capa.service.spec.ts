import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CapaService } from './capa.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_MANAGER'],
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
          const [field] = Object.entries(orderBy)[0]
          list = list.sort(
            (a, b) =>
              new Date(a[field] as string).getTime() - new Date(b[field] as string).getTime(),
          )
        }
        return Promise.resolve(list)
      },
    )
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<T> }) => {
      const existing = rows.get(where.id)!
      // Prisma silently drops `undefined` fields in a partial update rather than nulling them — the mock must too.
      const cleaned = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
      const updated = { ...existing, ...cleaned }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })
  return { rows, create, findFirst, findMany, update }
}

function buildHarness() {
  const tables = {
    capa: createTable({ status: 'open' }),
    auditFinding: createTable({ status: 'open' }),
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new CapaService(rls as never, auditService)
  return { service, tables, auditLog }
}

describe('CapaService', () => {
  describe('create()', () => {
    it('opens a standalone CAPA', async () => {
      const { service } = buildHarness()
      const capa = await service.create(
        actor,
        { title: 'Fix hotline number', correctiveAction: 'Update the number in the CRM' },
        {},
      )
      expect(capa.status).toBe('open')
      expect(capa.findingId).toBeNull()
    })

    it('links to a real finding and flips it to capa_assigned', async () => {
      const { service, tables } = buildHarness()
      tables.auditFinding.rows.set('finding-1', {
        id: 'finding-1',
        companyId: 'company-1',
        status: 'open',
      })

      const capa = await service.create(
        actor,
        { findingId: 'finding-1', title: 'x', correctiveAction: 'y' },
        {},
      )
      expect(capa.findingId).toBe('finding-1')
      expect(tables.auditFinding.rows.get('finding-1')!.status).toBe('capa_assigned')
    })

    it('404s when the finding does not exist', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(actor, { findingId: 'nonexistent', title: 'x', correctiveAction: 'y' }, {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(noCompanyActor, { title: 'x', correctiveAction: 'y' }, {}),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('close() — the effectiveness-check gate', () => {
    it('rejects closing a CAPA with no effectiveness check recorded', async () => {
      const { service } = buildHarness()
      const capa = await service.create(actor, { title: 'x', correctiveAction: 'y' }, {})
      await expect(service.close(actor, capa.id, {})).rejects.toThrow(ConflictException)
    })

    it('allows closing once an effectiveness check is recorded', async () => {
      const { service } = buildHarness()
      const capa = await service.create(actor, { title: 'x', correctiveAction: 'y' }, {})
      await service.recordEffectivenessCheck(actor, capa.id, { result: 'effective' }, {})

      const closed = await service.close(actor, capa.id, {})
      expect(closed.status).toBe('closed')
      expect(closed.closedAt).toBeInstanceOf(Date)
    })

    it('a "not_effective" result still lets the CAPA be closed (a real, honest outcome, not itself a block)', async () => {
      const { service } = buildHarness()
      const capa = await service.create(actor, { title: 'x', correctiveAction: 'y' }, {})
      await service.recordEffectivenessCheck(
        actor,
        capa.id,
        { result: 'not_effective', note: 'Recurred within a month' },
        {},
      )
      const closed = await service.close(actor, capa.id, {})
      expect(closed.status).toBe('closed')
    })

    it('rejects closing an already-closed CAPA', async () => {
      const { service } = buildHarness()
      const capa = await service.create(actor, { title: 'x', correctiveAction: 'y' }, {})
      await service.recordEffectivenessCheck(actor, capa.id, { result: 'effective' }, {})
      await service.close(actor, capa.id, {})
      await expect(service.close(actor, capa.id, {})).rejects.toThrow(ConflictException)
    })

    it('closing a CAPA linked to a finding also closes the finding', async () => {
      const { service, tables } = buildHarness()
      tables.auditFinding.rows.set('finding-1', {
        id: 'finding-1',
        companyId: 'company-1',
        status: 'open',
      })
      const capa = await service.create(
        actor,
        { findingId: 'finding-1', title: 'x', correctiveAction: 'y' },
        {},
      )
      await service.recordEffectivenessCheck(actor, capa.id, { result: 'effective' }, {})
      await service.close(actor, capa.id, {})
      expect(tables.auditFinding.rows.get('finding-1')!.status).toBe('closed')
    })
  })

  describe('update()', () => {
    it('rejects editing an already-closed CAPA', async () => {
      const { service } = buildHarness()
      const capa = await service.create(actor, { title: 'x', correctiveAction: 'y' }, {})
      await service.recordEffectivenessCheck(actor, capa.id, { result: 'effective' }, {})
      await service.close(actor, capa.id, {})
      await expect(
        service.update(actor, capa.id, { title: 'renamed' } as never, {}),
      ).rejects.toThrow(ConflictException)
    })
  })
})
