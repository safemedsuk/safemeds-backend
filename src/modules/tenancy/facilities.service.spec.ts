import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { FacilitiesService } from './facilities.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
  platformRole: null,
  tokenVersion: 1,
}

interface FacilityRow {
  id: string
  companyId: string
  countryId: string
  name: string
}

interface ScopeRow {
  level: 'market' | 'facility'
  countryId: string | null
  facilityId: string | null
  userId: string
}

function buildHarness(
  scopeRows: ScopeRow[],
  effectiveAccess: { unrestricted: boolean; facilityIds: string[] },
) {
  const facilities = new Map<string, FacilityRow>([
    [
      'facility-1',
      { id: 'facility-1', companyId: 'company-1', countryId: 'country-ke', name: 'Nairobi Branch' },
    ],
    [
      'facility-2',
      { id: 'facility-2', companyId: 'company-1', countryId: 'country-ke', name: 'Mombasa Branch' },
    ],
    [
      'facility-3',
      { id: 'facility-3', companyId: 'company-1', countryId: 'country-ug', name: 'Kampala Branch' },
    ],
  ])

  const facilityFindMany = jest
    .fn()
    .mockImplementation(({ where }: { where: { companyId: string; id?: { in: string[] } } }) => {
      let rows = [...facilities.values()].filter((f) => f.companyId === where.companyId)
      if (where.id) rows = rows.filter((f) => where.id!.in.includes(f.id))
      return Promise.resolve(rows.sort((a, b) => a.name.localeCompare(b.name)))
    })
  const scopeFindMany = jest
    .fn()
    .mockResolvedValue(scopeRows.map((s) => ({ ...s, companyId: 'company-1' })))

  const tables = {
    facility: { findMany: facilityFindMany },
    userLocationScope: { findMany: scopeFindMany },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const locationScopeService = { getEffectiveAccess: jest.fn().mockResolvedValue(effectiveAccess) }
  const auditService = { log: jest.fn().mockResolvedValue(undefined) }

  const service = new FacilitiesService(
    rls as never,
    auditService as never,
    locationScopeService as never,
  )
  return { service, locationScopeService }
}

describe('FacilitiesService.overview()', () => {
  it('returns every company facility for an unrestricted caller, with zero scoped users when nobody has been scoped yet', async () => {
    const { service } = buildHarness([], { unrestricted: true, facilityIds: [] })
    const result = await service.overview(actor)

    expect(result.unrestricted).toBe(true)
    expect(result.facilities).toHaveLength(3)
    expect(result.facilities.every((f) => f.scopedUserCount === 0)).toBe(true)
  })

  it('returns only the scoped facilities for a restricted caller', async () => {
    const { service } = buildHarness([], { unrestricted: false, facilityIds: ['facility-1'] })
    const result = await service.overview(actor)

    expect(result.unrestricted).toBe(false)
    expect(result.facilities).toHaveLength(1)
    expect(result.facilities[0].id).toBe('facility-1')
  })

  it('counts a facility-level grant toward exactly that facility', async () => {
    const { service } = buildHarness(
      [{ level: 'facility', facilityId: 'facility-1', countryId: null, userId: 'dept-head-1' }],
      {
        unrestricted: true,
        facilityIds: [],
      },
    )
    const result = await service.overview(actor)

    const f1 = result.facilities.find((f) => f.id === 'facility-1')!
    const f2 = result.facilities.find((f) => f.id === 'facility-2')!
    expect(f1.scopedUserCount).toBe(1)
    expect(f2.scopedUserCount).toBe(0)
  })

  it('expands a market-level grant to every facility in that country, and does not double-count a user scoped both ways', async () => {
    const { service } = buildHarness(
      [
        { level: 'market', countryId: 'country-ke', facilityId: null, userId: 'dept-head-1' },
        { level: 'facility', countryId: null, facilityId: 'facility-1', userId: 'dept-head-1' },
      ],
      { unrestricted: true, facilityIds: [] },
    )
    const result = await service.overview(actor)

    const f1 = result.facilities.find((f) => f.id === 'facility-1')!
    const f2 = result.facilities.find((f) => f.id === 'facility-2')!
    const f3 = result.facilities.find((f) => f.id === 'facility-3')!
    expect(f1.scopedUserCount).toBe(1)
    expect(f2.scopedUserCount).toBe(1)
    expect(f3.scopedUserCount).toBe(0)
  })
})

describe('FacilitiesService.updateLicence() — RegCloud Stage 10', () => {
  function buildLicenceHarness() {
    const existing = {
      id: 'facility-1',
      companyId: 'company-1',
      name: 'Nairobi Branch',
      licenceExpiresOn: new Date('2026-01-01'),
    }
    const findFirst = jest.fn().mockResolvedValue(existing)
    const update = jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ ...existing, ...data }))
    const tables = { facility: { findFirst, update } }
    const rls = {
      runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    }
    const auditLog = jest.fn().mockResolvedValue(undefined)
    const auditService = { log: auditLog }
    const locationScopeService = { getEffectiveAccess: jest.fn() }
    const service = new FacilitiesService(
      rls as never,
      auditService as never,
      locationScopeService as never,
    )
    return { service, findFirst, update, auditLog }
  }

  it('records the licence fields and audits the change', async () => {
    const { service, update, auditLog } = buildLicenceHarness()

    await service.updateLicence(
      actor,
      'facility-1',
      { licenceNumber: 'PPB-PREM-001', licenceIssuedOn: '2026-01-01', licenceStatus: 'active' },
      {},
    )

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'facility-1' },
        data: expect.objectContaining({ licenceNumber: 'PPB-PREM-001', licenceStatus: 'active' }),
      }),
    )
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'facility_licence_updated' }),
    )
  })

  it('clears the "already reminded" guard whenever a new expiry date is recorded', async () => {
    const { service, update } = buildLicenceHarness()

    await service.updateLicence(actor, 'facility-1', { licenceExpiresOn: '2031-01-01' }, {})

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          licenceExpiresOn: new Date('2031-01-01'),
          licenceRenewalNotifiedAt: null,
        }),
      }),
    )
  })

  it('404s for a facility in another company (invisible under RLS)', async () => {
    const { service, findFirst } = buildLicenceHarness()
    findFirst.mockResolvedValue(null)

    await expect(
      service.updateLicence(actor, 'other-co-facility', { licenceNumber: 'X' }, {}),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })
})
