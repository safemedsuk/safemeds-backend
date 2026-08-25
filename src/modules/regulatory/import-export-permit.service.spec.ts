import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ImportExportPermitService } from './import-export-permit.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog }

  const productFindFirst = jest.fn().mockResolvedValue({ id: 'product-1', companyId: 'company-1' })
  const registrationFindFirst = jest.fn().mockResolvedValue({ id: 'reg-1', companyId: 'company-1' })
  const authorityFindUnique = jest.fn().mockResolvedValue({ id: 'authority-1' })
  const permitFindMany = jest.fn().mockResolvedValue([])
  const permitCount = jest.fn().mockResolvedValue(0)
  const permitFindFirst = jest
    .fn()
    .mockResolvedValue({ id: 'permit-1', companyId: 'company-1', validTo: new Date('2027-01-01') })
  const permitCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const permitUpdate = jest
    .fn()
    .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))

  const tables = {
    product: { findFirst: productFindFirst },
    productRegistration: { findFirst: registrationFindFirst },
    regulatoryAuthority: { findUnique: authorityFindUnique },
    importExportPermit: {
      findMany: permitFindMany,
      count: permitCount,
      findFirst: permitFindFirst,
      create: permitCreate,
      update: permitUpdate,
    },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new ImportExportPermitService(rls as never, auditService as never)
  return {
    service,
    auditLog,
    productFindFirst,
    registrationFindFirst,
    authorityFindUnique,
    permitFindFirst,
    permitCreate,
    permitUpdate,
  }
}

describe('ImportExportPermitService.create', () => {
  it('creates a draft permit and audits it', async () => {
    const { service, permitCreate, auditLog } = buildHarness()

    await service.create(
      actor,
      { productId: 'product-1', authorityId: 'authority-1', permitType: 'import' },
      {},
    )

    expect(permitCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 'product-1',
          permitType: 'import',
          status: 'draft',
        }),
      }),
    )
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'import_export_permit_created' }),
    )
  })

  it('404s when the product does not belong to this company', async () => {
    const { service, productFindFirst } = buildHarness()
    productFindFirst.mockResolvedValue(null)

    await expect(
      service.create(
        actor,
        { productId: 'other-co-product', authorityId: 'authority-1', permitType: 'import' },
        {},
      ),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  it('404s when the optional product registration does not resolve', async () => {
    const { service, registrationFindFirst } = buildHarness()
    registrationFindFirst.mockResolvedValue(null)

    await expect(
      service.create(
        actor,
        {
          productId: 'product-1',
          productRegistrationId: 'other-co-reg',
          authorityId: 'authority-1',
          permitType: 'import',
        },
        {},
      ),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })

  it('404s when the authority does not exist', async () => {
    const { service, authorityFindUnique } = buildHarness()
    authorityFindUnique.mockResolvedValue(null)

    await expect(
      service.create(
        actor,
        { productId: 'product-1', authorityId: 'unknown-authority', permitType: 'import' },
        {},
      ),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })
})

describe('ImportExportPermitService.update', () => {
  it('clears the renewal-reminder guard whenever a new validTo is recorded', async () => {
    const { service, permitUpdate } = buildHarness()

    await service.update(actor, 'permit-1', { validTo: '2032-01-01' }, {})

    expect(permitUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ validTo: new Date('2032-01-01'), renewalNotifiedAt: null }),
      }),
    )
  })

  it('revokes a permit via the status field', async () => {
    const { service, permitUpdate } = buildHarness()

    await service.update(actor, 'permit-1', { status: 'revoked' }, {})

    expect(permitUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'revoked' } }),
    )
  })

  it('404s for a permit in another company (invisible under RLS)', async () => {
    const { service, permitFindFirst } = buildHarness()
    permitFindFirst.mockResolvedValue(null)

    await expect(
      service.update(actor, 'other-co-permit', { status: 'revoked' }, {}),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })
})
