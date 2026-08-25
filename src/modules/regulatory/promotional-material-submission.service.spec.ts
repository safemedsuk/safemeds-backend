import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PromotionalMaterialSubmissionService } from './promotional-material-submission.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditQuery = jest
    .fn()
    .mockResolvedValue({ data: [], meta: { page: 1, limit: 50, total: 0, totalPages: 0 } })
  const auditService = { log: auditLog, query: auditQuery } as never

  const instantiate = jest.fn().mockResolvedValue({ id: 'instance-1' })
  const workflowService = { instantiate } as never

  const productFindFirst = jest.fn().mockResolvedValue({ id: 'product-1', companyId: 'company-1' })
  const authorityFindUnique = jest.fn().mockResolvedValue({ id: 'authority-1', countryId: 'ke' })
  const documentFindUnique = jest.fn().mockResolvedValue({ id: 'doc-1', companyId: 'company-1' })

  const row = {
    id: 'submission-1',
    companyId: 'company-1',
    productId: 'product-1',
    authorityId: 'authority-1',
    materialType: 'print',
    materialDocumentId: null,
    status: 'draft',
  }
  const submissionCreate = jest.fn().mockResolvedValue(row)
  const submissionFindFirst = jest
    .fn()
    .mockResolvedValue({
      ...row,
      product: { brandName: 'Panadol' },
      authority: { name: 'PPB', code: 'KE-PPB' },
    })
  const submissionFindMany = jest.fn().mockResolvedValue([])
  const submissionCount = jest.fn().mockResolvedValue(0)
  const submissionUpdate = jest.fn().mockResolvedValue(row)

  const workflowInstanceFindFirst = jest.fn().mockResolvedValue(null)

  const tables = {
    product: { findFirst: productFindFirst },
    regulatoryAuthority: { findUnique: authorityFindUnique },
    document: { findUnique: documentFindUnique },
    promotionalMaterialSubmission: {
      create: submissionCreate,
      findFirst: submissionFindFirst,
      findMany: submissionFindMany,
      count: submissionCount,
      update: submissionUpdate,
    },
    workflowInstance: { findFirst: workflowInstanceFindFirst },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new PromotionalMaterialSubmissionService(
    rls as never,
    auditService,
    workflowService,
  )
  return {
    service,
    auditLog,
    instantiate,
    productFindFirst,
    authorityFindUnique,
    documentFindUnique,
    submissionCreate,
    submissionFindFirst,
    submissionUpdate,
  }
}

describe('PromotionalMaterialSubmissionService.create', () => {
  it('creates a draft submission and instantiates its workflow', async () => {
    const { service, submissionCreate, instantiate, auditLog } = buildHarness()

    await service.create(
      actor,
      { productId: 'product-1', authorityId: 'authority-1', materialType: 'print' },
      {},
    )

    expect(submissionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 'product-1',
          materialType: 'print',
          status: 'draft',
        }),
      }),
    )
    expect(instantiate).toHaveBeenCalledWith(
      actor,
      'promotional_material',
      'submission-1',
      'ke',
      {},
    )
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'promotional_material_submission_created' }),
    )
  })

  it('404s when the product does not belong to this company', async () => {
    const { service, productFindFirst } = buildHarness()
    productFindFirst.mockResolvedValue(null)

    await expect(
      service.create(
        actor,
        { productId: 'other-co-product', authorityId: 'authority-1', materialType: 'print' },
        {},
      ),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  it('404s when the authority does not exist', async () => {
    const { service, authorityFindUnique } = buildHarness()
    authorityFindUnique.mockResolvedValue(null)

    await expect(
      service.create(
        actor,
        { productId: 'product-1', authorityId: 'unknown-authority', materialType: 'print' },
        {},
      ),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  it('404s when an optional materialDocumentId does not resolve', async () => {
    const { service, documentFindUnique } = buildHarness()
    documentFindUnique.mockResolvedValue(null)

    await expect(
      service.create(
        actor,
        {
          productId: 'product-1',
          authorityId: 'authority-1',
          materialType: 'print',
          materialDocumentId: 'other-co-doc',
        },
        {},
      ),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })
})

describe('PromotionalMaterialSubmissionService.attachMaterialDocument', () => {
  it('attaches the document and audits it', async () => {
    const { service, submissionUpdate, auditLog } = buildHarness()

    await service.attachMaterialDocument(actor, 'submission-1', { documentId: 'doc-1' }, {})

    expect(submissionUpdate).toHaveBeenCalledWith({
      where: { id: 'submission-1' },
      data: { materialDocumentId: 'doc-1' },
    })
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'promotional_material_document_attached' }),
    )
  })

  it('404s for a submission in another company (invisible under RLS)', async () => {
    const { service, submissionFindFirst } = buildHarness()
    submissionFindFirst.mockResolvedValueOnce(null)

    await expect(
      service.attachMaterialDocument(actor, 'other-co-submission', { documentId: 'doc-1' }, {}),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })

  it('404s when the document does not resolve', async () => {
    const { service, documentFindUnique } = buildHarness()
    documentFindUnique.mockResolvedValue(null)

    await expect(
      service.attachMaterialDocument(actor, 'submission-1', { documentId: 'other-co-doc' }, {}),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })
})
