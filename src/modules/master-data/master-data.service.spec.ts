import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { MasterDataService } from './master-data.service'

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

  const productFindMany = jest.fn().mockResolvedValue([])
  const productCount = jest.fn().mockResolvedValue(0)
  const productFindUnique = jest.fn()
  const productCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const productUpdate = jest
    .fn()
    .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))

  const batchFindMany = jest.fn().mockResolvedValue([])
  const batchCount = jest.fn().mockResolvedValue(0)
  const batchFindUnique = jest.fn()
  const batchCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const batchUpdate = jest
    .fn()
    .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))

  const registrationFindMany = jest.fn().mockResolvedValue([])
  const registrationCount = jest.fn().mockResolvedValue(0)
  const registrationFindUnique = jest.fn()
  const registrationCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const registrationUpdate = jest
    .fn()
    .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))

  // Returns `null` by default so `recomputeRenewalDeadline()` (RegCloud
  // Stage 0.4) no-ops for every pre-existing test that doesn't care about
  // it — matching every other `resolve*`-style graceful-degradation path
  // in this codebase.
  const regulatoryAuthorityFindUnique = jest.fn().mockResolvedValue(null)
  const regDeadlineService = { computeOrRecompute: jest.fn().mockResolvedValue(null) }

  const tables = {
    product: {
      findMany: productFindMany,
      count: productCount,
      findUnique: productFindUnique,
      create: productCreate,
      update: productUpdate,
    },
    batch: {
      findMany: batchFindMany,
      count: batchCount,
      findUnique: batchFindUnique,
      create: batchCreate,
      update: batchUpdate,
    },
    productRegistration: {
      findMany: registrationFindMany,
      count: registrationCount,
      findUnique: registrationFindUnique,
      create: registrationCreate,
      update: registrationUpdate,
    },
    regulatoryAuthority: { findUnique: regulatoryAuthorityFindUnique },
  }

  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  // Unrestricted by default so every pre-existing test (none of which care
  // about location scoping) sees the exact same unfiltered `where` it
  // always did — matching every other "resolve*"-style graceful default.
  const getEffectiveAccess = jest
    .fn()
    .mockResolvedValue({ unrestricted: true, facilityIds: [], countryIds: [] })
  const locationScopeService = { getEffectiveAccess } as never
  const createApplicationFeeInvoiceOnRegistration = jest.fn().mockResolvedValue(undefined)
  const regFeeLedgerService = { createApplicationFeeInvoiceOnRegistration } as never
  // RegCloud Stage 8 — no-ops for every pre-existing test that doesn't care about it, matching `regDeadlineService`'s own graceful-default precedent above.
  const ensureObligationsForRegistration = jest.fn().mockResolvedValue(undefined)
  const regPostMarketObligationService = { ensureObligationsForRegistration } as never
  const service = new MasterDataService(
    rls as never,
    auditService,
    regDeadlineService as never,
    locationScopeService,
    regFeeLedgerService,
    regPostMarketObligationService,
  )

  return {
    service,
    auditLog,
    productFindMany,
    productFindUnique,
    productCreate,
    productUpdate,
    batchFindUnique,
    batchCreate,
    registrationFindUnique,
    registrationCreate,
    registrationUpdate,
    registrationFindMany,
    getEffectiveAccess,
    ensureObligationsForRegistration,
  }
}

describe('MasterDataService — tenant scoping', () => {
  it('refuses every operation for a platform (non-tenant-scoped) actor', async () => {
    const { service } = buildHarness()
    await expect(service.listProducts(platformActor, { page: 1, limit: 25 })).rejects.toMatchObject(
      { response: { code: 'FORBIDDEN' } },
    )
    await expect(
      service.createProduct(
        platformActor,
        {
          brandName: 'x',
          genericName: 'y',
          productCategory: 'medicinal',
          dosageForm: 'tablet',
          strength: '500mg',
        },
        {},
      ),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } })
  })
})

describe('MasterDataService — products', () => {
  it('creates a product scoped to the actor company and audits it', async () => {
    const { service, productCreate, auditLog } = buildHarness()

    const created = await service.createProduct(
      actor,
      {
        brandName: 'Amoxiclav',
        genericName: 'Amoxicillin/Clavulanate',
        productCategory: 'medicinal',
        dosageForm: 'tablet',
        strength: '500mg/125mg',
      },
      { ip: '10.0.0.1' },
    )

    expect(productCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ companyId: 'company-1', brandName: 'Amoxiclav' }),
      }),
    )
    expect(created.companyId).toBe('company-1')
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'product_created' }),
    )
  })

  it('404s updating a product that does not exist', async () => {
    const { service, productFindUnique } = buildHarness()
    productFindUnique.mockResolvedValue(null)

    await expect(
      service.updateProduct(actor, 'missing', { brandName: 'x' }, {}),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })

  it('deactivates a product by setting isActive: false, never deleting it', async () => {
    const { service, productFindUnique, productUpdate, auditLog } = buildHarness()
    productFindUnique.mockResolvedValue({ id: 'p1', isActive: true })

    const result = await service.deactivateProduct(actor, 'p1', {})

    expect(productUpdate).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { isActive: false } })
    expect(result.isActive).toBe(false)
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'product_deactivated' }),
    )
  })

  it('searches by brandName/genericName/innName/atcCode (trigram-indexed contains) — Stage 2\'s "select by brand, INN, or ATC" requirement', async () => {
    const { service, productFindMany } = buildHarness()

    await service.listProducts(actor, { page: 1, limit: 25, q: 'amox' })

    expect(productFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { brandName: { contains: 'amox', mode: 'insensitive' } },
            { genericName: { contains: 'amox', mode: 'insensitive' } },
            { innName: { contains: 'amox', mode: 'insensitive' } },
            { atcCode: { contains: 'amox', mode: 'insensitive' } },
          ],
        }),
      }),
    )
  })

  it('carries the Stage 2 PV-mandatory fields (INN, ATC, formulation, route, site of manufacture, pack sizes) through to the created row', async () => {
    const { service, productCreate } = buildHarness()

    await service.createProduct(
      actor,
      {
        brandName: 'Amoxiclav',
        genericName: 'Amoxicillin/Clavulanate',
        productCategory: 'medicinal',
        dosageForm: 'tablet',
        strength: '500mg/125mg',
        innName: 'Amoxicillin and Enzyme Inhibitor',
        atcCode: 'J01CR02',
        formulation: 'immediate release',
        routeOfAdministration: 'Oral',
        siteOfManufacture: 'Nairobi, Kenya',
        packSizes: ['10s blister', '30s bottle'],
      },
      {},
    )

    expect(productCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          innName: 'Amoxicillin and Enzyme Inhibitor',
          atcCode: 'J01CR02',
          formulation: 'immediate release',
          routeOfAdministration: 'Oral',
          siteOfManufacture: 'Nairobi, Kenya',
          packSizes: ['10s blister', '30s bottle'],
        }),
      }),
    )
  })
})

describe('MasterDataService — batches', () => {
  it('404s creating a batch for a product that does not exist', async () => {
    const { service, productFindUnique } = buildHarness()
    productFindUnique.mockResolvedValue(null)

    await expect(
      service.createBatch(
        actor,
        {
          productId: 'missing',
          batchNumber: 'B-1',
          manufacturedOn: '2026-01-01',
          expiresOn: '2028-01-01',
        },
        {},
      ),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })

  it('creates a batch against an existing product', async () => {
    const harness = buildHarness()
    harness.productFindUnique.mockResolvedValue({ id: 'prod-1' })

    const created = await harness.service.createBatch(
      actor,
      {
        productId: 'prod-1',
        batchNumber: 'B-2026-001',
        manufacturedOn: '2026-01-01',
        expiresOn: '2028-01-01',
      },
      {},
    )

    expect(harness.batchCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          productId: 'prod-1',
          batchNumber: 'B-2026-001',
        }),
      }),
    )
    expect(created.companyId).toBe('company-1')
  })
})

describe('MasterDataService — product registrations', () => {
  it('creates a registration at status active by default', async () => {
    const harness = buildHarness()
    harness.productFindUnique.mockResolvedValue({ id: 'prod-1' })

    const created = await harness.service.createRegistration(
      actor,
      {
        productId: 'prod-1',
        authorityId: 'ppb',
        registrationNumber: 'PPB/REG/2026/001',
        issuedOn: '2026-01-01',
        expiresOn: '2027-01-01',
      },
      {},
    )

    expect(created.status).toBe('active')
  })

  it('deactivating a registration sets status to withdrawn, not deleted', async () => {
    const { service, registrationFindUnique, registrationUpdate, auditLog } = buildHarness()
    registrationFindUnique.mockResolvedValue({ id: 'reg-1', status: 'active' })

    const result = await service.deactivateRegistration(actor, 'reg-1', {})

    expect(registrationUpdate).toHaveBeenCalledWith({
      where: { id: 'reg-1' },
      data: { status: 'withdrawn' },
    })
    expect(result.status).toBe('withdrawn')
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'product_registration_withdrawn' }),
    )
  })

  it('filters by expiringWithinDays', async () => {
    const { service, registrationFindMany } = buildHarness()

    await service.listRegistrations(actor, { page: 1, limit: 25, expiringWithinDays: 90 })

    expect(registrationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ expiresOn: { lte: expect.any(Date) } }),
      }),
    )
  })

  // RegCloud (Phase 12) Stage 0.6 — cross-module joins & access scoping.
  it('an unrestricted actor sees every registration regardless of country', async () => {
    const { service, registrationFindMany } = buildHarness()

    await service.listRegistrations(actor, { page: 1, limit: 25 })

    expect(registrationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ authority: expect.anything() }),
      }),
    )
  })

  it('a market/facility-scoped actor only sees registrations under an authority in one of their granted countries', async () => {
    const { service, registrationFindMany, getEffectiveAccess } = buildHarness()
    getEffectiveAccess.mockResolvedValue({
      unrestricted: false,
      facilityIds: [],
      countryIds: ['country-ke'],
    })

    await service.listRegistrations(actor, { page: 1, limit: 25 })

    expect(registrationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ authority: { countryId: { in: ['country-ke'] } } }),
      }),
    )
  })
})
