import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { SdeaService } from './sdea.service'

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
    .mockImplementation(
      ({
        where,
        orderBy,
      }: {
        where: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'>
      }) => {
        let list = [...rows.values()].filter((r) => matches(r, where))
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0]
          list = list.sort(
            (a, b) => (Number(a[field]) - Number(b[field])) * (dir === 'desc' ? -1 : 1),
          )
        }
        return Promise.resolve(list[0] ?? null)
      },
    )
  const findMany = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {}))),
    )
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<T> }) => {
      const existing = rows.get(where.id)!
      const updated = { ...existing, ...data }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })
  return { rows, create, findFirst, findMany, update }
}

function buildHarness() {
  const tables = {
    sdea: createTable({ status: 'draft' }),
    distributor: createTable(),
    document: createTable(),
  }
  tables.distributor.rows.set('dist-1', { id: 'dist-1', companyId: 'company-1' })

  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new SdeaService(rls as never, auditService)
  return { service, tables, auditLog }
}

describe('SdeaService', () => {
  describe('create()', () => {
    it('creates the first draft at version 1', async () => {
      const { service } = buildHarness()
      const sdea = await service.create(
        actor,
        { distributorId: 'dist-1', title: 'Meridian SDEA', counterpartyName: 'Meridian Pharma' },
        {},
      )
      expect(sdea.version).toBe(1)
      expect(sdea.status).toBe('draft')
    })

    it('404s on an unknown distributor', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(
          actor,
          { distributorId: 'nonexistent', title: 'x', counterpartyName: 'y' },
          {},
        ),
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(
          noCompanyActor,
          { distributorId: 'dist-1', title: 'x', counterpartyName: 'y' },
          {},
        ),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('activate()', () => {
    it('rejects activating a draft with no document', async () => {
      const { service } = buildHarness()
      const sdea = await service.create(
        actor,
        { distributorId: 'dist-1', title: 'x', counterpartyName: 'y' },
        {},
      )
      await expect(service.activate(actor, sdea.id, {})).rejects.toThrow(ConflictException)
    })

    it('activates and supersedes the previous active version for the same distributor', async () => {
      const { service, tables } = buildHarness()

      const v1 = await service.create(
        actor,
        { distributorId: 'dist-1', title: 'v1', counterpartyName: 'y' },
        {},
      )
      tables.document.rows.set('doc-1', {
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'sdea',
        recordId: v1.id,
      })
      await service.attachDocument(actor, v1.id, { documentId: 'doc-1' }, {})
      await service.activate(actor, v1.id, {})

      const v2 = await service.create(
        actor,
        { distributorId: 'dist-1', title: 'v2', counterpartyName: 'y' },
        {},
      )
      tables.document.rows.set('doc-2', {
        id: 'doc-2',
        companyId: 'company-1',
        recordType: 'sdea',
        recordId: v2.id,
      })
      await service.attachDocument(actor, v2.id, { documentId: 'doc-2' }, {})
      const activatedV2 = await service.activate(actor, v2.id, {})

      expect(activatedV2.status).toBe('active')
      expect(tables.sdea.rows.get(v1.id)!.status).toBe('superseded')
    })
  })

  describe('getStatusForDistributor()', () => {
    it('returns missing when no active SDEA exists', async () => {
      const { service } = buildHarness()
      const status = await service.getStatusForDistributor(actor, 'dist-1')
      expect(status.status).toBe('missing')
    })

    it('returns active for a healthy, far-from-expiry SDEA', async () => {
      const { service, tables } = buildHarness()
      const farFuture = new Date()
      farFuture.setDate(farFuture.getDate() + 365)
      tables.sdea.rows.set('sdea-1', {
        id: 'sdea-1',
        companyId: 'company-1',
        distributorId: 'dist-1',
        status: 'active',
        expiryDate: farFuture,
      })

      const status = await service.getStatusForDistributor(actor, 'dist-1')
      expect(status.status).toBe('active')
    })

    it('returns expiring within the 60-day warning window', async () => {
      const { service, tables } = buildHarness()
      const soon = new Date()
      soon.setDate(soon.getDate() + 30)
      tables.sdea.rows.set('sdea-1', {
        id: 'sdea-1',
        companyId: 'company-1',
        distributorId: 'dist-1',
        status: 'active',
        expiryDate: soon,
      })

      const status = await service.getStatusForDistributor(actor, 'dist-1')
      expect(status.status).toBe('expiring')
    })

    it('returns expired once past the expiry date', async () => {
      const { service, tables } = buildHarness()
      const past = new Date()
      past.setDate(past.getDate() - 1)
      tables.sdea.rows.set('sdea-1', {
        id: 'sdea-1',
        companyId: 'company-1',
        distributorId: 'dist-1',
        status: 'active',
        expiryDate: past,
      })

      const status = await service.getStatusForDistributor(actor, 'dist-1')
      expect(status.status).toBe('expired')
    })

    it('an active SDEA with no expiry date at all is treated as active, never expiring', async () => {
      const { service, tables } = buildHarness()
      tables.sdea.rows.set('sdea-1', {
        id: 'sdea-1',
        companyId: 'company-1',
        distributorId: 'dist-1',
        status: 'active',
        expiryDate: null,
      })

      const status = await service.getStatusForDistributor(actor, 'dist-1')
      expect(status.status).toBe('active')
    })
  })
})
