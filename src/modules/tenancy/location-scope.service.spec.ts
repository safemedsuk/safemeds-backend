import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { LocationScopeService } from './location-scope.service'

const actor: AuthenticatedUser = {
  sub: 'admin-1',
  companyId: 'company-1',
  roleKeys: ['SYSTEM_ADMINISTRATOR'],
  platformRole: null,
  tokenVersion: 1,
}

interface ScopeRow {
  id: string
  companyId: string
  userId: string
  level: 'market' | 'facility'
  countryId: string | null
  facilityId: string | null
  grantedBy: string
  createdAt: Date
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const scopes = new Map<string, ScopeRow>()
  const users = new Map<string, { id: string; companyId: string }>([
    ['target-user', { id: 'target-user', companyId: 'company-1' }],
  ])
  const countries = new Map<string, { id: string; name: string }>([
    ['country-ke', { id: 'country-ke', name: 'Kenya' }],
  ])
  const facilities = new Map<
    string,
    { id: string; companyId: string; name: string; countryId: string }
  >([
    [
      'facility-1',
      { id: 'facility-1', companyId: 'company-1', name: 'Nairobi Branch', countryId: 'country-ke' },
    ],
    [
      'facility-2',
      { id: 'facility-2', companyId: 'company-1', name: 'Mombasa Branch', countryId: 'country-ke' },
    ],
  ])

  const userFindFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: { id: string; companyId: string } }) => {
      const u = users.get(where.id)
      return Promise.resolve(u && u.companyId === where.companyId ? u : null)
    })
  const countryFindUnique = jest
    .fn()
    .mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(countries.get(where.id) ?? null),
    )
  const facilityFindFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: { id: string; companyId: string } }) => {
      const f = facilities.get(where.id)
      return Promise.resolve(f && f.companyId === where.companyId ? f : null)
    })
  const facilityFindMany = jest
    .fn()
    .mockImplementation(
      ({
        where,
      }: {
        where: { companyId: string; countryId?: { in: string[] }; id?: { in: string[] } }
      }) => {
        return Promise.resolve(
          [...facilities.values()].filter(
            (f) =>
              f.companyId === where.companyId &&
              (where.countryId ? where.countryId.in.includes(f.countryId) : true) &&
              (where.id ? where.id.in.includes(f.id) : true),
          ),
        )
      },
    )

  const scopeFindFirst = jest.fn().mockImplementation(({ where }: { where: Partial<ScopeRow> }) => {
    const match = [...scopes.values()].find((s) =>
      Object.entries(where).every(([k, v]) => v === undefined || s[k as keyof ScopeRow] === v),
    )
    return Promise.resolve(match ?? null)
  })
  const scopeFindMany = jest.fn().mockImplementation(({ where }: { where: Partial<ScopeRow> }) => {
    const rows = [...scopes.values()].filter((s) =>
      Object.entries(where).every(([k, v]) => v === undefined || s[k as keyof ScopeRow] === v),
    )
    return Promise.resolve(
      rows.map((s) => ({
        ...s,
        country: s.countryId ? countries.get(s.countryId) : null,
        facility: s.facilityId ? facilities.get(s.facilityId) : null,
      })),
    )
  })
  const scopeCreate = jest
    .fn()
    .mockImplementation(({ data }: { data: Omit<ScopeRow, 'createdAt'> }) => {
      const row: ScopeRow = { ...data, createdAt: new Date() }
      scopes.set(row.id, row)
      return Promise.resolve(row)
    })
  const scopeDelete = jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
    scopes.delete(where.id)
    return Promise.resolve()
  })

  const tables = {
    user: { findFirst: userFindFirst },
    country: { findUnique: countryFindUnique },
    facility: { findFirst: facilityFindFirst, findMany: facilityFindMany },
    userLocationScope: {
      findFirst: scopeFindFirst,
      findMany: scopeFindMany,
      create: scopeCreate,
      delete: scopeDelete,
    },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new LocationScopeService(rls as never, auditService)
  return { service, scopes, auditLog }
}

describe('LocationScopeService', () => {
  describe('grant()', () => {
    it('grants a facility-level scope and audits it', async () => {
      const { service, auditLog } = buildHarness()
      const scope = await service.grant(
        actor,
        'target-user',
        { level: 'facility', facilityId: 'facility-1' },
        {},
      )

      expect(scope.level).toBe('facility')
      expect(scope.facilityId).toBe('facility-1')
      expect(scope.countryId).toBeNull()
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'location_scope_granted' }),
      )
    })

    it('resolves the facility name onto the response, not just the id — the FE renders this directly without a second fetch', async () => {
      const { service } = buildHarness()
      const scope = await service.grant(
        actor,
        'target-user',
        { level: 'facility', facilityId: 'facility-1' },
        {},
      )

      expect(scope.facilityName).toBe('Nairobi Branch')
      expect(scope.countryName).toBeNull()
    })

    it('grants a market-level scope', async () => {
      const { service } = buildHarness()
      const scope = await service.grant(
        actor,
        'target-user',
        { level: 'market', countryId: 'country-ke' },
        {},
      )

      expect(scope.level).toBe('market')
      expect(scope.countryId).toBe('country-ke')
      expect(scope.facilityId).toBeNull()
      expect(scope.countryName).toBe('Kenya')
      expect(scope.facilityName).toBeNull()
    })

    it('rejects a market-level grant missing countryId', async () => {
      const { service } = buildHarness()
      await expect(service.grant(actor, 'target-user', { level: 'market' }, {})).rejects.toThrow(
        BadRequestException,
      )
    })

    it('rejects a facility-level grant that also carries a countryId', async () => {
      const { service } = buildHarness()
      await expect(
        service.grant(
          actor,
          'target-user',
          { level: 'facility', facilityId: 'facility-1', countryId: 'country-ke' },
          {},
        ),
      ).rejects.toThrow(BadRequestException)
    })

    it('404s on a facility from another company', async () => {
      const { service } = buildHarness()
      await expect(
        service.grant(
          actor,
          'target-user',
          { level: 'facility', facilityId: 'not-a-real-facility' },
          {},
        ),
      ).rejects.toThrow(NotFoundException)
    })

    it('404s on a user not in this company', async () => {
      const { service } = buildHarness()
      await expect(
        service.grant(
          actor,
          'not-a-real-user',
          { level: 'facility', facilityId: 'facility-1' },
          {},
        ),
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects granting the exact same scope twice', async () => {
      const { service } = buildHarness()
      await service.grant(actor, 'target-user', { level: 'facility', facilityId: 'facility-1' }, {})
      await expect(
        service.grant(actor, 'target-user', { level: 'facility', facilityId: 'facility-1' }, {}),
      ).rejects.toThrow(ConflictException)
    })

    it('rejects a platform-staff actor with no company context', async () => {
      const { service } = buildHarness()
      const platformActor: AuthenticatedUser = {
        sub: 'staff-1',
        companyId: null,
        roleKeys: [],
        platformRole: 'super_admin',
        tokenVersion: 1,
      }
      await expect(
        service.grant(
          platformActor,
          'target-user',
          { level: 'facility', facilityId: 'facility-1' },
          {},
        ),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('revoke()', () => {
    it('removes a scope and audits it', async () => {
      const { service, scopes, auditLog } = buildHarness()
      const scope = await service.grant(
        actor,
        'target-user',
        { level: 'facility', facilityId: 'facility-1' },
        {},
      )

      await service.revoke(actor, scope.id, {})

      expect(scopes.has(scope.id)).toBe(false)
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'location_scope_revoked' }),
      )
    })

    it('404s revoking an unknown scope', async () => {
      const { service } = buildHarness()
      await expect(service.revoke(actor, 'not-a-real-scope', {})).rejects.toThrow(NotFoundException)
    })
  })

  describe('getEffectiveAccess()', () => {
    it('is unrestricted for SYSTEM_ADMINISTRATOR regardless of scope rows', async () => {
      const { service } = buildHarness()
      const access = await service.getEffectiveAccess('company-1', 'target-user', [
        'SYSTEM_ADMINISTRATOR',
      ])
      expect(access).toEqual({ unrestricted: true, facilityIds: [], countryIds: [] })
    })

    it('is unrestricted for a non-admin user with zero scope rows (the default)', async () => {
      const { service } = buildHarness()
      const access = await service.getEffectiveAccess('company-1', 'target-user', ['QPPV'])
      expect(access).toEqual({ unrestricted: true, facilityIds: [], countryIds: [] })
    })

    it('is restricted to exactly the granted facility once one scope row exists', async () => {
      const { service } = buildHarness()
      await service.grant(actor, 'target-user', { level: 'facility', facilityId: 'facility-1' }, {})

      const access = await service.getEffectiveAccess('company-1', 'target-user', ['QPPV'])
      expect(access.unrestricted).toBe(false)
      expect(access.facilityIds).toEqual(['facility-1'])
    })

    it('expands a market-level grant to every facility currently in that country', async () => {
      const { service } = buildHarness()
      await service.grant(actor, 'target-user', { level: 'market', countryId: 'country-ke' }, {})

      const access = await service.getEffectiveAccess('company-1', 'target-user', ['QPPV'])
      expect(access.unrestricted).toBe(false)
      expect(access.facilityIds.sort()).toEqual(['facility-1', 'facility-2'])
    })

    // RegCloud (Phase 12) Stage 0.6 — `countryIds`, the new field this stage
    // added alongside the pre-existing `facilityIds`, for a record (like
    // `ProductRegistration`) that has a country dimension but no facility.
    it('a market-level grant surfaces its own countryId directly in countryIds', async () => {
      const { service } = buildHarness()
      await service.grant(actor, 'target-user', { level: 'market', countryId: 'country-ke' }, {})

      const access = await service.getEffectiveAccess('company-1', 'target-user', ['QPPV'])
      expect(access.countryIds).toEqual(['country-ke'])
    })

    it("a facility-level grant surfaces that facility's own country in countryIds too", async () => {
      const { service } = buildHarness()
      await service.grant(actor, 'target-user', { level: 'facility', facilityId: 'facility-1' }, {})

      const access = await service.getEffectiveAccess('company-1', 'target-user', ['QPPV'])
      expect(access.countryIds).toEqual(['country-ke'])
    })
  })

  describe('listForUser()', () => {
    it('includes resolved country/facility names for display', async () => {
      const { service } = buildHarness()
      await service.grant(actor, 'target-user', { level: 'facility', facilityId: 'facility-1' }, {})
      await service.grant(actor, 'target-user', { level: 'market', countryId: 'country-ke' }, {})

      const list = await service.listForUser(actor, 'target-user')
      expect(list).toHaveLength(2)
      expect(list.find((s) => s.level === 'facility')?.facilityName).toBe('Nairobi Branch')
      expect(list.find((s) => s.level === 'market')?.countryName).toBe('Kenya')
    })
  })
})
