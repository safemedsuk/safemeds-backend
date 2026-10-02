import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegEntitiesService } from './reg-entities.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}
const platformActor: AuthenticatedUser = {
  sub: 'p1',
  companyId: null,
  roleKeys: [],
  platformRole: 'super_admin',
  tokenVersion: 1,
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const manufacturerCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const manufacturerUpdate = jest
    .fn()
    .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))
  const manufacturerFindUnique = jest.fn()
  const manufacturerFindFirst = jest.fn()
  const manufacturerFindMany = jest.fn().mockResolvedValue([])
  const manufacturerCount = jest.fn().mockResolvedValue(0)

  const manufacturingSiteCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const manufacturingSiteFindUnique = jest.fn()

  const localRepresentativeCreate = jest
    .fn()
    .mockImplementation(({ data }) => Promise.resolve(data))
  const localRepresentativeFindUnique = jest.fn()

  const tables = {
    manufacturer: {
      create: manufacturerCreate,
      update: manufacturerUpdate,
      findUnique: manufacturerFindUnique,
      findFirst: manufacturerFindFirst,
      findMany: manufacturerFindMany,
      count: manufacturerCount,
    },
    manufacturingSite: { create: manufacturingSiteCreate, findUnique: manufacturingSiteFindUnique },
    localRepresentative: {
      create: localRepresentativeCreate,
      findUnique: localRepresentativeFindUnique,
    },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new RegEntitiesService(rls as never, auditService)
  return {
    service,
    auditLog,
    manufacturerCreate,
    manufacturerUpdate,
    manufacturerFindUnique,
    manufacturerFindFirst,
    manufacturingSiteCreate,
    manufacturingSiteFindUnique,
    localRepresentativeCreate,
  }
}

describe('RegEntitiesService — tenant scoping', () => {
  it('refuses every operation for a platform (non-tenant-scoped) actor', async () => {
    const { service } = buildHarness()
    await expect(
      service.listManufacturers(platformActor, { page: 1, limit: 25 }),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } })
    await expect(
      service.createManufacturer(platformActor, { name: 'Acme Pharma' }, {}),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } })
  })
})

describe('RegEntitiesService — manufacturers', () => {
  it('creates a manufacturer scoped to the actor company and audits it', async () => {
    const { service, manufacturerCreate, auditLog } = buildHarness()

    const created = await service.createManufacturer(
      actor,
      { name: 'Acme Pharma', countryId: 'in' },
      { ip: '1.2.3.4' },
    )

    expect(created.companyId).toBe('company-1')
    expect(manufacturerCreate).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        companyId: 'company-1',
        name: 'Acme Pharma',
        countryId: 'in',
      },
    })
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'manufacturer_created', companyId: 'company-1' }),
    )
  })

  it('deactivateManufacturer 404s when the manufacturer does not exist (or belongs to another tenant, invisible under RLS)', async () => {
    const { service, manufacturerFindUnique } = buildHarness()
    manufacturerFindUnique.mockResolvedValue(null)

    await expect(service.deactivateManufacturer(actor, 'nope', {})).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  describe('findManufacturerByName (testing-correction-explanation.md §4.1 — the bulk importer\'s de-duplication lookup)', () => {
    it('matches an existing manufacturer case-insensitively', async () => {
      const { service, manufacturerFindFirst } = buildHarness()
      manufacturerFindFirst.mockResolvedValue({ id: 'manufacturer-1', name: 'Acme Pharma' })

      const found = await service.findManufacturerByName(actor, 'acme pharma')

      expect(found).toMatchObject({ id: 'manufacturer-1' })
      expect(manufacturerFindFirst).toHaveBeenCalledWith({
        where: { companyId: 'company-1', name: { equals: 'acme pharma', mode: 'insensitive' }, isActive: true },
      })
    })

    it('returns null when no manufacturer matches', async () => {
      const { service, manufacturerFindFirst } = buildHarness()
      manufacturerFindFirst.mockResolvedValue(null)

      expect(await service.findManufacturerByName(actor, 'Nobody Pharma')).toBeNull()
    })
  })
})

describe('RegEntitiesService — manufacturing sites', () => {
  it('createManufacturingSite 404s when the parent manufacturer does not resolve', async () => {
    const { service, manufacturerFindUnique } = buildHarness()
    manufacturerFindUnique.mockResolvedValue(null)

    await expect(
      service.createManufacturingSite(
        actor,
        { manufacturerId: 'missing', siteName: 'Plant 1' },
        {},
      ),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })

  it('createManufacturingSite succeeds and carries the GMP certificate fields through', async () => {
    const { service, manufacturerFindUnique, manufacturingSiteCreate } = buildHarness()
    manufacturerFindUnique.mockResolvedValue({ id: 'manufacturer-1' })

    await service.createManufacturingSite(
      actor,
      {
        manufacturerId: 'manufacturer-1',
        siteName: 'Plant 1',
        gmpCertificateNumber: 'GMP-123',
        gmpCertificateExpiresOn: '2028-06-01',
      },
      {},
    )

    expect(manufacturingSiteCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        manufacturerId: 'manufacturer-1',
        siteName: 'Plant 1',
        gmpCertificateNumber: 'GMP-123',
        gmpCertificateExpiresOn: new Date('2028-06-01'),
      }),
    })
  })
})

describe('RegEntitiesService — local representatives', () => {
  it('creates a local representative scoped to the actor company', async () => {
    const { service, localRepresentativeCreate } = buildHarness()

    await service.createLocalRepresentative(
      actor,
      { name: 'Nairobi Regulatory Services Ltd', contactEmail: 'ops@nrsl.co.ke' },
      {},
    )

    expect(localRepresentativeCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-1',
        name: 'Nairobi Regulatory Services Ltd',
      }),
    })
  })
})
