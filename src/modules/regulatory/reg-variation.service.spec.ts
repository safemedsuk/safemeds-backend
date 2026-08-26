import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegVariationService } from './reg-variation.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

const registrationRow = {
  id: 'reg-1',
  productId: 'product-1',
  authorityId: 'authority-1',
  productClass: 'generic_pharma',
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const create = jest.fn().mockResolvedValue({ id: 'dossier-1', documentSlots: [] })
  const regDossierService = { create } as never

  const productRegistrationFindFirst = jest.fn().mockResolvedValue(registrationRow)
  const regVariationCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const regVariationFindFirst = jest.fn()
  const regVariationFindMany = jest.fn().mockResolvedValue([])

  const tables = {
    productRegistration: { findFirst: productRegistrationFindFirst },
    regVariation: {
      create: regVariationCreate,
      findFirst: regVariationFindFirst,
      findMany: regVariationFindMany,
    },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new RegVariationService(rls as never, auditService, regDossierService)
  return {
    service,
    auditLog,
    create,
    productRegistrationFindFirst,
    regVariationCreate,
    regVariationFindFirst,
    regVariationFindMany,
  }
}

describe('RegVariationService.create', () => {
  it('404s when the target registration does not exist', async () => {
    const { service, productRegistrationFindFirst } = buildHarness()
    productRegistrationFindFirst.mockResolvedValue(null)

    await expect(
      service.create(actor, { productRegistrationId: 'reg-1', variationType: 'renewal' }, {}),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })

  it('creates the dossier via RegDossierService.create(), pre-setting productRegistrationId, defaulting product/authority/class from the target registration', async () => {
    const { service, create } = buildHarness()

    await service.create(actor, { productRegistrationId: 'reg-1', variationType: 'renewal' }, {})

    expect(create).toHaveBeenCalledWith(
      actor,
      {
        productId: 'product-1',
        authorityId: 'authority-1',
        productClass: 'generic_pharma',
        route: undefined,
      },
      {},
      'reg-1',
    )
  })

  it('honors explicit overrides for product/authority/class/route instead of the registration defaults', async () => {
    const { service, create } = buildHarness()

    await service.create(
      actor,
      {
        productRegistrationId: 'reg-1',
        variationType: 'line_extension',
        productClass: 'new_class',
        route: 'oral',
      },
      {},
    )

    expect(create).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ productClass: 'new_class', route: 'oral' }),
      {},
      'reg-1',
    )
  })

  it('creates a real RegVariation row wrapping the new dossier, with status "open"', async () => {
    const { service, regVariationCreate } = buildHarness()

    const result = await service.create(
      actor,
      { productRegistrationId: 'reg-1', variationType: 'renewal' },
      {},
    )

    expect(regVariationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productRegistrationId: 'reg-1',
          variationType: 'renewal',
          regDossierId: 'dossier-1',
          status: 'open',
        }),
      }),
    )
    expect(result.regDossier.id).toBe('dossier-1')
  })
})

describe('RegVariationService.list/get', () => {
  it('list() scopes by productRegistrationId', async () => {
    const { service, regVariationFindMany } = buildHarness()
    await service.list(actor, 'reg-1')
    expect(regVariationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'company-1', productRegistrationId: 'reg-1' },
      }),
    )
  })

  it('get() 404s when the variation does not exist', async () => {
    const { service, regVariationFindFirst } = buildHarness()
    regVariationFindFirst.mockResolvedValue(null)
    await expect(service.get(actor, 'var-1')).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })
})
