import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RecallService } from './recall.service'

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
  const capaFindFirst = jest.fn().mockResolvedValue({ id: 'capa-1', companyId: 'company-1' })

  const row = {
    id: 'recall-1',
    companyId: 'company-1',
    productId: 'product-1',
    reason: 'Contamination detected',
    recallClass: null,
    status: 'reported',
    rootCauseCapaId: null,
  }
  const recallCreate = jest.fn().mockResolvedValue(row)
  const recallFindFirst = jest.fn().mockResolvedValue({ ...row, product: { brandName: 'Panadol' } })
  const recallFindMany = jest.fn().mockResolvedValue([])
  const recallCount = jest.fn().mockResolvedValue(0)

  const recallCaseFindUnique = jest.fn().mockResolvedValue(null)
  const recallCaseCreate = jest.fn().mockResolvedValue({})
  const recallCaseFindMany = jest.fn().mockResolvedValue([])

  const workflowInstanceFindFirst = jest.fn().mockResolvedValue(null)

  const tables = {
    product: { findFirst: productFindFirst },
    capa: { findFirst: capaFindFirst },
    recall: {
      create: recallCreate,
      findFirst: recallFindFirst,
      findMany: recallFindMany,
      count: recallCount,
    },
    recallCase: {
      findUnique: recallCaseFindUnique,
      create: recallCaseCreate,
      findMany: recallCaseFindMany,
    },
    workflowInstance: { findFirst: workflowInstanceFindFirst },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new RecallService(rls as never, auditService, workflowService)
  return {
    service,
    auditLog,
    instantiate,
    productFindFirst,
    capaFindFirst,
    recallCreate,
    recallFindFirst,
    recallCaseFindUnique,
    recallCaseCreate,
  }
}

describe('RecallService.create', () => {
  it('creates a reported recall and instantiates its workflow with no country', async () => {
    const { service, recallCreate, instantiate, auditLog } = buildHarness()

    await service.create(actor, { productId: 'product-1', reason: 'Contamination detected' }, {})

    expect(recallCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 'product-1',
          reason: 'Contamination detected',
          status: 'reported',
          initiatedBy: 'user-1',
        }),
      }),
    )
    expect(instantiate).toHaveBeenCalledWith(actor, 'recall', 'recall-1', null, {})
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'recall_created' }),
    )
  })

  it('links evidence cases given at creation time', async () => {
    const { service, recallCaseCreate } = buildHarness()

    await service.create(
      actor,
      { productId: 'product-1', reason: 'Contamination detected', caseIds: ['case-1', 'case-2'] },
      {},
    )

    expect(recallCaseCreate).toHaveBeenCalledTimes(2)
    expect(recallCaseCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ recallId: 'recall-1', caseId: 'case-1' }),
      }),
    )
  })

  it('404s when the product does not belong to this company', async () => {
    const { service, productFindFirst } = buildHarness()
    productFindFirst.mockResolvedValue(null)

    await expect(
      service.create(actor, { productId: 'other-co-product', reason: 'x' }, {}),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })

  it('404s when an optional rootCauseCapaId does not resolve', async () => {
    const { service, capaFindFirst } = buildHarness()
    capaFindFirst.mockResolvedValue(null)

    await expect(
      service.create(
        actor,
        { productId: 'product-1', reason: 'x', rootCauseCapaId: 'other-co-capa' },
        {},
      ),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })
})

describe('RecallService.linkCases', () => {
  it('links only newly-linked cases and audits the count', async () => {
    const { service, recallCaseCreate, auditLog } = buildHarness()

    await service.linkCases(actor, 'recall-1', ['case-3'], {})

    expect(recallCaseCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ recallId: 'recall-1', caseId: 'case-3' }),
      }),
    )
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'recall_cases_linked',
        newValue: expect.objectContaining({ newlyLinked: 1 }),
      }),
    )
  })

  it('skips a case that is already linked and does not audit an empty link', async () => {
    const { service, recallCaseFindUnique, recallCaseCreate, auditLog } = buildHarness()
    recallCaseFindUnique.mockResolvedValue({ id: 'link-1' })

    await service.linkCases(actor, 'recall-1', ['case-3'], {})

    expect(recallCaseCreate).not.toHaveBeenCalled()
    expect(auditLog).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'recall_cases_linked' }),
    )
  })

  it('404s for a recall in another company (invisible under RLS)', async () => {
    const { service, recallFindFirst } = buildHarness()
    recallFindFirst.mockResolvedValueOnce(null)

    await expect(service.linkCases(actor, 'other-co-recall', ['case-1'], {})).rejects.toMatchObject(
      { response: { code: 'NOT_FOUND' } },
    )
  })
})
