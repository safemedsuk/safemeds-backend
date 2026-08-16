import { ConflictException, ForbiddenException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { EntitlementsService } from './entitlements.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['SYSTEM_ADMINISTRATOR'],
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

interface EntitlementRow {
  id: string
  companyId: string
  moduleKey: string
  featureKey: string
  enabled: boolean
  grantedBy: string
}

interface CompanyRow {
  id: string
  name: string
  companyType: string
  status: string
  homeCountry: { name: string; isoCode: string }
}

// Defaults to `company-1` already having an active PSMF, since most of
// this spec's pre-existing tests grant a module-level `vigicloud`
// entitlement incidentally, not to exercise Stage 16.1's own gate — the
// gate's own tests below pass `[]` explicitly to exercise the blocked path.
function buildHarness(
  seedCompanies: CompanyRow[] = [],
  activePsmfCompanyIds: string[] = ['company-1'],
) {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const rows = new Map<string, EntitlementRow>()

  function keyOf(companyId: string, moduleKey: string, featureKey: string): string {
    return `${companyId}::${moduleKey}::${featureKey}`
  }

  const findUnique = jest
    .fn()
    .mockImplementation(
      ({
        where,
      }: {
        where: {
          companyId_moduleKey_featureKey: {
            companyId: string
            moduleKey: string
            featureKey: string
          }
        }
      }) => {
        const k = where.companyId_moduleKey_featureKey
        return Promise.resolve(rows.get(keyOf(k.companyId, k.moduleKey, k.featureKey)) ?? null)
      },
    )
  const findMany = jest.fn().mockImplementation(({ where }: { where: { companyId: string } }) => {
    return Promise.resolve([...rows.values()].filter((r) => r.companyId === where.companyId))
  })
  const upsert = jest
    .fn()
    .mockImplementation(
      ({
        where,
        create,
        update,
      }: {
        where: {
          companyId_moduleKey_featureKey: {
            companyId: string
            moduleKey: string
            featureKey: string
          }
        }
        create: EntitlementRow
        update: Partial<EntitlementRow>
      }) => {
        const k = where.companyId_moduleKey_featureKey
        const mapKey = keyOf(k.companyId, k.moduleKey, k.featureKey)
        const existing = rows.get(mapKey)
        const row = existing ? { ...existing, ...update } : create
        rows.set(mapKey, row)
        return Promise.resolve(row)
      },
    )

  const companyFindMany = jest
    .fn()
    .mockImplementation(
      ({
        where,
        skip,
        take,
      }: {
        where: { name?: { contains: string } }
        skip: number
        take: number
      }) => {
        let matches = seedCompanies
        if (where.name?.contains) {
          const needle = where.name.contains.toLowerCase()
          matches = matches.filter((c) => c.name.toLowerCase().includes(needle))
        }
        return Promise.resolve(matches.slice(skip, skip + take))
      },
    )
  const companyCount = jest
    .fn()
    .mockImplementation(({ where }: { where: { name?: { contains: string } } }) => {
      let matches = seedCompanies
      if (where.name?.contains) {
        const needle = where.name.contains.toLowerCase()
        matches = matches.filter((c) => c.name.toLowerCase().includes(needle))
      }
      return Promise.resolve(matches.length)
    })

  const psmfFindFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: { companyId: string; status: string } }) =>
      Promise.resolve(
        activePsmfCompanyIds.includes(where.companyId) && where.status === 'active'
          ? { id: `psmf-${where.companyId}`, companyId: where.companyId, status: 'active' }
          : null,
      ),
    )

  const tables = {
    entitlement: { findUnique, findMany, upsert },
    company: { findMany: companyFindMany, count: companyCount },
    psmf: { findFirst: psmfFindFirst },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithPlatformAccess: (
      _actorUserId: string,
      _reason: string,
      fn: (tx: typeof tables) => unknown,
    ) => fn(tables),
  }

  const service = new EntitlementsService(rls as never, auditService)
  return { service, rows, auditLog }
}

describe('EntitlementsService', () => {
  describe('isEnabled()', () => {
    it('returns false when no entitlement row exists at all', async () => {
      const { service } = buildHarness()
      await expect(service.isEnabled('company-1', 'vigicloud')).resolves.toBe(false)
    })

    it('returns true once a module-level grant exists', async () => {
      const { service } = buildHarness()
      await service.grant('staff-1', 'company-1', { moduleKey: 'vigicloud', enabled: true }, {})
      await expect(service.isEnabled('company-1', 'vigicloud')).resolves.toBe(true)
    })

    it('a feature-specific row overrides the module-level row when checking that exact feature', async () => {
      const { service } = buildHarness()
      await service.grant('staff-1', 'company-1', { moduleKey: 'vigicloud', enabled: true }, {})
      await service.grant(
        'staff-1',
        'company-1',
        { moduleKey: 'vigicloud', featureKey: 'signal_management', enabled: false },
        {},
      )

      await expect(service.isEnabled('company-1', 'vigicloud', 'signal_management')).resolves.toBe(
        false,
      )
      await expect(service.isEnabled('company-1', 'vigicloud')).resolves.toBe(true)
    })

    it('falls back to the module-level row when no feature-specific row exists', async () => {
      const { service } = buildHarness()
      await service.grant('staff-1', 'company-1', { moduleKey: 'vigicloud', enabled: true }, {})
      await expect(
        service.isEnabled('company-1', 'vigicloud', 'some_ungranted_feature'),
      ).resolves.toBe(true)
    })

    it('does not leak entitlements across companies', async () => {
      const { service } = buildHarness()
      await service.grant('staff-1', 'company-1', { moduleKey: 'vigicloud', enabled: true }, {})
      await expect(service.isEnabled('company-2', 'vigicloud')).resolves.toBe(false)
    })
  })

  describe('grant()', () => {
    it('upserts and audits both the create and the update case', async () => {
      const { service, auditLog } = buildHarness()

      const created = await service.grant(
        'staff-1',
        'company-1',
        { moduleKey: 'vigicloud', enabled: true },
        {},
      )
      expect(created.enabled).toBe(true)
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'entitlement_granted', oldValue: undefined }),
      )

      const revoked = await service.grant(
        'staff-1',
        'company-1',
        { moduleKey: 'vigicloud', enabled: false },
        {},
      )
      expect(revoked.enabled).toBe(false)
      expect(auditLog).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'entitlement_granted', oldValue: { enabled: true } }),
      )
    })

    // VigiCloud Stage 16.1 — the PSMF onboarding gate.
    it('blocks switching vigicloud on when no active PSMF exists for the company', async () => {
      const { service } = buildHarness([], [])
      await expect(
        service.grant('staff-1', 'company-1', { moduleKey: 'vigicloud', enabled: true }, {}),
      ).rejects.toThrow(ConflictException)
    })

    it('allows switching vigicloud on once an active PSMF exists', async () => {
      const { service } = buildHarness([], ['company-1'])
      const granted = await service.grant(
        'staff-1',
        'company-1',
        { moduleKey: 'vigicloud', enabled: true },
        {},
      )
      expect(granted.enabled).toBe(true)
    })

    it('does not gate disabling vigicloud even with no active PSMF', async () => {
      const { service } = buildHarness([], [])
      const revoked = await service.grant(
        'staff-1',
        'company-1',
        { moduleKey: 'vigicloud', enabled: false },
        {},
      )
      expect(revoked.enabled).toBe(false)
    })

    it('does not gate a feature-level toggle within an already-on module', async () => {
      const { service } = buildHarness([], [])
      const granted = await service.grant(
        'staff-1',
        'company-1',
        { moduleKey: 'vigicloud', featureKey: 'signal_management', enabled: true },
        {},
      )
      expect(granted.enabled).toBe(true)
    })

    it('does not gate a non-vigicloud module', async () => {
      const { service } = buildHarness([], [])
      const granted = await service.grant(
        'staff-1',
        'company-1',
        { moduleKey: 'qualcloud', enabled: true },
        {},
      )
      expect(granted.enabled).toBe(true)
    })
  })

  describe('listMine()', () => {
    it('rejects a platform-staff actor with no company context', async () => {
      const { service } = buildHarness()
      await expect(service.listMine(platformActor)).rejects.toThrow(ForbiddenException)
    })

    it("returns the caller's own company entitlements", async () => {
      const { service } = buildHarness()
      await service.grant('staff-1', 'company-1', { moduleKey: 'vigicloud', enabled: true }, {})
      const mine = await service.listMine(actor)
      expect(mine).toHaveLength(1)
      expect(mine[0].moduleKey).toBe('vigicloud')
    })
  })

  describe('listCompanies()', () => {
    it('filters by a case-insensitive name substring', async () => {
      const { service } = buildHarness([
        {
          id: 'c1',
          name: 'Acme Pharma',
          companyType: 'manufacturer',
          status: 'active',
          homeCountry: { name: 'Kenya', isoCode: 'KE' },
        },
        {
          id: 'c2',
          name: 'Zenith Distributors',
          companyType: 'importer_distributor',
          status: 'active',
          homeCountry: { name: 'Uganda', isoCode: 'UG' },
        },
      ])

      const page = await service.listCompanies({ page: 1, limit: 25, q: 'acme' })
      expect(page.data).toHaveLength(1)
      expect(page.data[0].name).toBe('Acme Pharma')
      expect(page.data[0].homeCountryIsoCode).toBe('KE')
    })
  })
})
