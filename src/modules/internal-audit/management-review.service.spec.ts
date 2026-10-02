import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ManagementReviewService } from './management-review.service'

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

  const compute = jest.fn().mockResolvedValue({ deviationsOpened: 1 })
  const metricsService = { compute } as never

  const createFrom = jest.fn().mockResolvedValue({ id: 'capa-1' })
  const capaService = { createFrom } as never

  const qualityTrendFlagFindMany = jest.fn().mockResolvedValue([])
  const managementReviewCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const managementReviewFindFirst = jest.fn()
  const managementReviewUpdate = jest
    .fn()
    .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))
  const managementReviewFindMany = jest.fn().mockResolvedValue([])

  const tables = {
    qualityTrendFlag: { findMany: qualityTrendFlagFindMany },
    managementReview: {
      create: managementReviewCreate,
      findFirst: managementReviewFindFirst,
      update: managementReviewUpdate,
      findMany: managementReviewFindMany,
    },
  }
  const rls = { runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables) }

  const service = new ManagementReviewService(rls as never, auditService, metricsService, capaService)
  return {
    service,
    auditLog,
    compute,
    createFrom,
    managementReviewCreate,
    managementReviewFindFirst,
    managementReviewUpdate,
    managementReviewFindMany,
  }
}

describe('ManagementReviewService.schedule', () => {
  it('freezes a live metrics snapshot and the currently-open trend flags onto the new row', async () => {
    const { service, compute, managementReviewCreate } = buildHarness()

    await service.schedule(actor, { period: 'Q1 2026', reviewDate: '2026-03-31' }, {})

    expect(compute).toHaveBeenCalledWith(actor, expect.objectContaining({ to: new Date('2026-03-31') }))
    expect(managementReviewCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          period: 'Q1 2026',
          metricsSnapshot: { deviationsOpened: 1 },
        }),
      }),
    )
  })
})

describe('ManagementReviewService.recordActions', () => {
  it('404s recording actions against a review that does not exist', async () => {
    const { service, managementReviewFindFirst } = buildHarness()
    managementReviewFindFirst.mockResolvedValue(null)

    await expect(
      service.recordActions(actor, 'ghost', { actions: [] }, {}),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })

  it('records plain actions with no CAPA when openCapa is not set', async () => {
    const { service, managementReviewFindFirst, managementReviewUpdate, createFrom } = buildHarness()
    managementReviewFindFirst.mockResolvedValue({ id: 'review-1' })

    await service.recordActions(
      actor,
      'review-1',
      { actions: [{ description: 'Retrain packaging line staff.' }] },
      {},
    )

    expect(createFrom).not.toHaveBeenCalled()
    expect(managementReviewUpdate).toHaveBeenCalledWith({
      where: { id: 'review-1' },
      data: { actionsAgreed: [{ description: 'Retrain packaging line staff.', capaId: null }] },
    })
  })

  it('opens a real CAPA via CapaService.createFrom when an action requests it', async () => {
    const { service, managementReviewFindFirst, createFrom, managementReviewUpdate } = buildHarness()
    managementReviewFindFirst.mockResolvedValue({ id: 'review-1' })

    await service.recordActions(
      actor,
      'review-1',
      {
        actions: [
          {
            description: 'Revalidate the packaging line.',
            openCapa: true,
            rootCauseCategory: 'packaging_defect',
            ownerUserId: 'owner-1',
          },
        ],
      },
      {},
    )

    expect(createFrom).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      'company-1',
      'management_review',
      'review-1',
      expect.objectContaining({
        title: 'Revalidate the packaging line.',
        rootCauseCategory: 'packaging_defect',
        ownerUserId: 'owner-1',
      }),
      {},
    )
    expect(managementReviewUpdate).toHaveBeenCalledWith({
      where: { id: 'review-1' },
      data: {
        actionsAgreed: [
          expect.objectContaining({ description: 'Revalidate the packaging line.', capaId: 'capa-1' }),
        ],
      },
    })
  })
})
