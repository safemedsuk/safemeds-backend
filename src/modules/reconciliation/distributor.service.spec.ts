import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { DistributorService } from './distributor.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['REGULATORY_AFFAIRS_OFFICER'],
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
        'contains' in (value as Record<string, unknown>)
      ) {
        const clause = value as { contains: string; mode?: string }
        const rowVal = typeof row[key] === 'string' ? row[key] : ''
        return clause.mode === 'insensitive'
          ? rowVal.toLowerCase().includes(clause.contains.toLowerCase())
          : rowVal.includes(clause.contains)
      }
      return row[key] === value
    })
  }
  const create = jest.fn().mockImplementation(({ data }: { data: T }) => {
    // Mirrors the schema's own `status DistributorStatus @default(active)` — the real Prisma client applies this default when the caller's data omits it; this mock must too.
    rows.set(data.id, { status: 'active', ...data })
    return Promise.resolve(rows.get(data.id))
  })
  const findFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].find((r) => matches(r, where)) ?? null),
    )
  const findUnique = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      // A composite-unique lookup (e.g. companyId_name) comes through as a nested object value; a simple `{ id }` lookup is already flat.
      const [key, value] = Object.entries(where)[0]
      const flattened =
        value !== null && typeof value === 'object'
          ? (value as Record<string, unknown>)
          : { [key]: value }
      return Promise.resolve([...rows.values()].find((r) => matches(r, flattened)) ?? null)
    })
  const findMany = jest
    .fn()
    .mockImplementation(
      ({
        where,
        skip,
        take,
        orderBy,
      }: {
        where?: Record<string, unknown>
        skip?: number
        take?: number
        orderBy?: Record<string, 'asc' | 'desc'>
      }) => {
        let list = [...rows.values()].filter((r) => matches(r, where ?? {}))
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0]
          list = list.sort(
            (a, b) => String(a[field]).localeCompare(String(b[field])) * (dir === 'desc' ? -1 : 1),
          )
        }
        if (skip !== undefined || take !== undefined)
          list = list.slice(skip ?? 0, (skip ?? 0) + (take ?? list.length))
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
  return { rows, create, findFirst, findUnique, findMany, count, update }
}

function buildHarness(permissions: string[] = ['reconciliation.manage']) {
  const tables = { distributor: createTable(), company: createTable() }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithPlatformAccess: (
      _actorUserId: string,
      _reason: string,
      fn: (tx: typeof tables) => unknown,
    ) => fn(tables),
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const getPermissionsForUser = jest.fn().mockResolvedValue(new Set(permissions))
  const rolesService = { getPermissionsForUser } as never

  const service = new DistributorService(rls as never, auditService, rolesService)
  return { service, tables, auditLog }
}

function baseDto(overrides: Partial<Parameters<DistributorService['create']>[1]> = {}) {
  return { name: 'Acme Distribution Ltd', ...overrides }
}

describe('DistributorService', () => {
  describe('create()', () => {
    it('creates a distributor and audits it', async () => {
      const { service, tables, auditLog } = buildHarness()
      const result = await service.create(actor, baseDto(), {})
      expect(result.name).toBe('Acme Distribution Ltd')
      expect(tables.distributor.rows.size).toBe(1)
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'distributor_created' }),
      )
    })

    it('rejects a duplicate name within the same company', async () => {
      const { service } = buildHarness()
      await service.create(actor, baseDto(), {})
      await expect(service.create(actor, baseDto(), {})).rejects.toThrow(ConflictException)
    })

    it('rejects a platform-staff actor with no company', async () => {
      const { service } = buildHarness()
      await expect(service.create(platformActor, baseDto(), {})).rejects.toThrow(ForbiddenException)
    })
  })

  describe('list()/get() read access', () => {
    it('allows reconciliation.view without reconciliation.manage', async () => {
      const { service } = buildHarness(['reconciliation.view'])
      const result = await service.list(actor, { page: 1, limit: 20 })
      expect(result.data).toEqual([])
    })

    it('rejects an actor with neither qualifying permission', async () => {
      const { service } = buildHarness([])
      await expect(service.list(actor, { page: 1, limit: 20 })).rejects.toThrow(ForbiddenException)
    })

    it('get() 404s for a distributor in a different company', async () => {
      const { service, tables } = buildHarness()
      tables.distributor.rows.set('d1', { id: 'd1', companyId: 'a-different-company' })
      await expect(service.get(actor, 'd1')).rejects.toThrow(NotFoundException)
    })
  })

  describe('update()', () => {
    it('updates fields and audits old/new status', async () => {
      const { service, auditLog } = buildHarness()
      const created = await service.create(actor, baseDto(), {})
      const updated = await service.update(actor, created.id, { status: 'inactive' }, {})
      expect(updated.status).toBe('inactive')
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'distributor_updated',
          oldValue: { name: 'Acme Distribution Ltd', status: 'active' },
        }),
      )
    })

    it('404s for a distributor that does not exist in this company', async () => {
      const { service } = buildHarness()
      await expect(
        service.update(actor, 'not-a-real-id', { status: 'inactive' }, {}),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('linkTenant()', () => {
    it('links a distributor to a real, active company', async () => {
      const { service, tables, auditLog } = buildHarness()
      const created = await service.create(actor, baseDto(), {})
      tables.company.rows.set('tenant-1', { id: 'tenant-1', status: 'active' })

      const linked = await service.linkTenant('platform-staff-1', created.id, 'tenant-1', {})
      expect(linked.distributorCompanyId).toBe('tenant-1')
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'distributor_tenant_linked' }),
      )
    })

    it('unlinks when targetCompanyId is null', async () => {
      const { service, tables } = buildHarness()
      const created = await service.create(actor, baseDto(), {})
      tables.company.rows.set('tenant-1', { id: 'tenant-1', status: 'active' })
      await service.linkTenant('platform-staff-1', created.id, 'tenant-1', {})

      const unlinked = await service.linkTenant('platform-staff-1', created.id, null, {})
      expect(unlinked.distributorCompanyId).toBeNull()
    })

    it('rejects linking to a non-existent company', async () => {
      const { service } = buildHarness()
      const created = await service.create(actor, baseDto(), {})
      await expect(
        service.linkTenant('platform-staff-1', created.id, 'not-a-real-company', {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects linking to an inactive company', async () => {
      const { service, tables } = buildHarness()
      const created = await service.create(actor, baseDto(), {})
      tables.company.rows.set('tenant-1', { id: 'tenant-1', status: 'suspended' })
      await expect(
        service.linkTenant('platform-staff-1', created.id, 'tenant-1', {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects a company linking itself as its own distributor', async () => {
      const { service, tables } = buildHarness()
      const created = await service.create(actor, baseDto(), {})
      tables.company.rows.set('company-1', { id: 'company-1', status: 'active' })
      await expect(
        service.linkTenant('platform-staff-1', created.id, 'company-1', {}),
      ).rejects.toThrow(ConflictException)
    })
  })

  // testing-todo 15.1 — platform-wide browsing and the auto-match
  // suggestion for the tenant-to-tenant distributor-linking flow.
  describe('listAllForPlatform()', () => {
    it('lists distributors across every tenant, with owner and linked-tenant names resolved', async () => {
      const { service, tables } = buildHarness()
      const row = tables.distributor.rows
      row.set('dist-1', {
        id: 'dist-1',
        name: 'Acme Distribution Ltd',
        companyId: 'mfg-1',
        company: { name: 'Acme Manufacturer' },
        distributorCompanyId: 'tenant-1',
        distributorCompany: { name: 'Acme Distribution Ltd (Tenant)' },
      })
      row.set('dist-2', {
        id: 'dist-2',
        name: 'Unlinked Co',
        companyId: 'mfg-1',
        company: { name: 'Acme Manufacturer' },
        distributorCompanyId: null,
        distributorCompany: null,
      })

      const result = await service.listAllForPlatform({ page: 1, limit: 25 })

      expect(result.data).toHaveLength(2)
      const linked = result.data.find((d) => d.id === 'dist-1')!
      expect(linked.ownerCompanyName).toBe('Acme Manufacturer')
      expect(linked.distributorCompanyName).toBe('Acme Distribution Ltd (Tenant)')
      const unlinked = result.data.find((d) => d.id === 'dist-2')!
      expect(unlinked.distributorCompanyId).toBeNull()
      expect(unlinked.distributorCompanyName).toBeNull()
    })

    it('unlinkedOnly filters out already-linked distributors', async () => {
      const { service, tables } = buildHarness()
      tables.distributor.rows.set('dist-1', {
        id: 'dist-1',
        name: 'A',
        companyId: 'mfg-1',
        company: { name: 'Mfg' },
        distributorCompanyId: 'tenant-1',
        distributorCompany: { name: 'T' },
      })
      tables.distributor.rows.set('dist-2', {
        id: 'dist-2',
        name: 'B',
        companyId: 'mfg-1',
        company: { name: 'Mfg' },
        distributorCompanyId: null,
        distributorCompany: null,
      })

      const result = await service.listAllForPlatform({ page: 1, limit: 25, unlinkedOnly: true })

      expect(result.data.map((d) => d.id)).toEqual(['dist-2'])
    })
  })

  describe('suggestTenantMatches()', () => {
    it('suggests an active company whose name overlaps the distributor name, case-insensitively', async () => {
      const { service, tables } = buildHarness()
      tables.distributor.rows.set('dist-1', {
        id: 'dist-1',
        name: 'pfizer kenya ltd',
        companyId: 'mfg-1',
      })
      tables.company.rows.set('tenant-1', {
        id: 'tenant-1',
        name: 'Pfizer Kenya',
        status: 'active',
      })
      tables.company.rows.set('tenant-2', {
        id: 'tenant-2',
        name: 'Completely Unrelated Co',
        status: 'active',
      })

      const suggestions = await service.suggestTenantMatches('dist-1')

      expect(suggestions).toEqual([{ companyId: 'tenant-1', companyName: 'Pfizer Kenya' }])
    })

    it("never suggests the distributor's own owning company", async () => {
      const { service, tables } = buildHarness()
      tables.distributor.rows.set('dist-1', {
        id: 'dist-1',
        name: 'Acme Distribution',
        companyId: 'mfg-1',
      })
      tables.company.rows.set('mfg-1', { id: 'mfg-1', name: 'Acme Distribution', status: 'active' })

      const suggestions = await service.suggestTenantMatches('dist-1')

      expect(suggestions).toEqual([])
    })

    it('never suggests an inactive company', async () => {
      const { service, tables } = buildHarness()
      tables.distributor.rows.set('dist-1', {
        id: 'dist-1',
        name: 'Acme Distribution',
        companyId: 'mfg-1',
      })
      tables.company.rows.set('tenant-1', {
        id: 'tenant-1',
        name: 'Acme Distribution',
        status: 'suspended',
      })

      const suggestions = await service.suggestTenantMatches('dist-1')

      expect(suggestions).toEqual([])
    })

    it('404s on an unknown distributor', async () => {
      const { service } = buildHarness()
      await expect(service.suggestTenantMatches('nonexistent')).rejects.toThrow(NotFoundException)
    })
  })
})
