import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RelianceApplicationService } from './reliance-application.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const productFindFirst = jest.fn().mockResolvedValue({ id: 'product-1', companyId: 'company-1' })
  const authorityFindUnique = jest
    .fn()
    .mockResolvedValue({ id: 'authority-lead', name: 'Lead Authority', code: 'LEAD' })

  const row = {
    id: 'reliance-1',
    companyId: 'company-1',
    productId: 'product-1',
    pathwayType: 'eac_joint_assessment',
    leadAuthorityId: 'authority-lead',
    participatingAuthorityIds: ['authority-a'],
    status: 'active',
  }
  const relianceApplicationCreate = jest.fn().mockResolvedValue(row)
  const relianceApplicationFindFirst = jest
    .fn()
    .mockResolvedValue({
      ...row,
      product: { brandName: 'Panadol' },
      leadAuthority: { name: 'Lead Authority', code: 'LEAD' },
    })
  const relianceApplicationFindMany = jest.fn().mockResolvedValue([])
  const relianceApplicationCount = jest.fn().mockResolvedValue(0)
  const relianceApplicationUpdate = jest.fn().mockResolvedValue(row)

  const regulatoryAuthorityFindMany = jest.fn().mockResolvedValue([
    { id: 'authority-lead', name: 'Lead Authority', code: 'LEAD' },
    { id: 'authority-a', name: 'Authority A', code: 'A' },
  ])
  const regDossierFindMany = jest.fn().mockResolvedValue([])
  const regDossierFindFirst = jest.fn().mockResolvedValue(null)

  const tables = {
    product: { findFirst: productFindFirst },
    regulatoryAuthority: { findUnique: authorityFindUnique, findMany: regulatoryAuthorityFindMany },
    relianceApplication: {
      create: relianceApplicationCreate,
      findFirst: relianceApplicationFindFirst,
      findMany: relianceApplicationFindMany,
      count: relianceApplicationCount,
      update: relianceApplicationUpdate,
    },
    regDossier: { findMany: regDossierFindMany, findFirst: regDossierFindFirst },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const create = jest.fn().mockResolvedValue({ id: 'dossier-1', status: 'planning' })
  const regDossierService = { create } as never

  const service = new RelianceApplicationService(rls as never, auditService, regDossierService)
  return {
    service,
    auditLog,
    productFindFirst,
    authorityFindUnique,
    relianceApplicationCreate,
    relianceApplicationFindFirst,
    relianceApplicationUpdate,
    regDossierFindFirst,
    create,
  }
}

describe('RelianceApplicationService.create', () => {
  it('creates the wrapper row first, then the lead dossier through RegDossierService with relianceApplicationId set', async () => {
    const { service, relianceApplicationCreate, create, auditLog } = buildHarness()

    await service.create(
      actor,
      {
        productId: 'product-1',
        pathwayType: 'eac_joint_assessment',
        leadAuthorityId: 'authority-lead',
        participatingAuthorityIds: ['authority-a'],
        productClass: 'generic_pharma',
      },
      {},
    )

    expect(relianceApplicationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pathwayType: 'eac_joint_assessment',
          leadAuthorityId: 'authority-lead',
          participatingAuthorityIds: ['authority-a'],
        }),
      }),
    )
    expect(create).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        productId: 'product-1',
        authorityId: 'authority-lead',
        productClass: 'generic_pharma',
        relianceApplicationId: 'reliance-1',
      }),
      {},
    )
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'reliance_application_created' }),
    )
  })

  it('404s when the product does not belong to this company', async () => {
    const { service, productFindFirst } = buildHarness()
    productFindFirst.mockResolvedValue(null)

    await expect(
      service.create(
        actor,
        {
          productId: 'other-co-product',
          pathwayType: 'who_crp',
          leadAuthorityId: 'authority-lead',
          productClass: 'generic_pharma',
        },
        {},
      ),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })

  it('404s when the lead authority does not exist', async () => {
    const { service, authorityFindUnique } = buildHarness()
    authorityFindUnique.mockResolvedValue(null)

    await expect(
      service.create(
        actor,
        {
          productId: 'product-1',
          pathwayType: 'who_crp',
          leadAuthorityId: 'unknown-authority',
          productClass: 'generic_pharma',
        },
        {},
      ),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })
})

describe('RelianceApplicationService.startDossierForAuthority', () => {
  it('starts a dossier for a known participating authority', async () => {
    const { service, create } = buildHarness()

    await service.startDossierForAuthority(
      actor,
      'reliance-1',
      { authorityId: 'authority-a', productClass: 'generic_pharma' },
      {},
    )

    expect(create).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ authorityId: 'authority-a', relianceApplicationId: 'reliance-1' }),
      {},
    )
  })

  it('refuses an authority that is neither the lead nor a participating authority', async () => {
    const { service } = buildHarness()

    await expect(
      service.startDossierForAuthority(
        actor,
        'reliance-1',
        { authorityId: 'authority-unknown', productClass: 'generic_pharma' },
        {},
      ),
    ).rejects.toMatchObject({
      response: { code: 'AUTHORITY_NOT_LINKED' },
    })
  })

  it('refuses to start a second dossier for an authority that already has one', async () => {
    const { service, regDossierFindFirst } = buildHarness()
    regDossierFindFirst.mockResolvedValue({ id: 'existing-dossier' })

    await expect(
      service.startDossierForAuthority(
        actor,
        'reliance-1',
        { authorityId: 'authority-a', productClass: 'generic_pharma' },
        {},
      ),
    ).rejects.toMatchObject({
      response: { code: 'DOSSIER_ALREADY_STARTED' },
    })
  })
})

describe('RelianceApplicationService.close', () => {
  it('marks the application closed and audits it', async () => {
    const { service, relianceApplicationUpdate, auditLog } = buildHarness()

    await service.close(actor, 'reliance-1', {})

    expect(relianceApplicationUpdate).toHaveBeenCalledWith({
      where: { id: 'reliance-1' },
      data: { status: 'closed' },
    })
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'reliance_application_closed' }),
    )
  })
})
