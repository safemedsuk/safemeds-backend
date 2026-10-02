import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { QualityTrendDetectionService } from './quality-trend-detection.service'

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

  const notificationCreate = jest.fn().mockResolvedValue(undefined)
  const notificationsService = { create: notificationCreate } as never

  const companyFindMany = jest.fn().mockResolvedValue([
    { id: 'company-1', qualityTrendThresholdCount: null, qualityTrendWindowDays: null },
  ])
  const capaFindMany = jest.fn().mockResolvedValue([])
  const qualityTrendFlagFindMany = jest.fn().mockResolvedValue([])
  const qualityTrendFlagUpsert = jest.fn().mockImplementation(({ create }) => Promise.resolve(create))
  const qualityTrendFlagUpdate = jest
    .fn()
    .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))
  const qualityTrendFlagFindFirst = jest.fn()
  const userFindMany = jest.fn().mockResolvedValue([{ id: 'qm-1' }])

  const tables = {
    company: { findMany: companyFindMany },
    capa: { findMany: capaFindMany },
    qualityTrendFlag: {
      findMany: qualityTrendFlagFindMany,
      upsert: qualityTrendFlagUpsert,
      update: qualityTrendFlagUpdate,
      findFirst: qualityTrendFlagFindFirst,
    },
    user: { findMany: userFindMany },
  }
  const rls = {
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new QualityTrendDetectionService(rls as never, auditService, notificationsService)
  return {
    service,
    auditLog,
    notificationCreate,
    companyFindMany,
    capaFindMany,
    qualityTrendFlagFindMany,
    qualityTrendFlagUpsert,
    qualityTrendFlagUpdate,
    qualityTrendFlagFindFirst,
    userFindMany,
  }
}

describe('QualityTrendDetectionService.scanAndFlag', () => {
  it('does nothing when no root-cause category reaches the default 3-in-180-days threshold', async () => {
    const { service, capaFindMany, qualityTrendFlagUpsert } = buildHarness()
    capaFindMany.mockResolvedValue([
      { id: 'c1', rootCauseCategory: 'packaging_defect' },
      { id: 'c2', rootCauseCategory: 'packaging_defect' },
    ])

    const result = await service.scanAndFlag()
    expect(qualityTrendFlagUpsert).not.toHaveBeenCalled()
    expect(result.flagsOpened).toBe(0)
  })

  it('opens a new flag once a category reaches the threshold, and notifies every QUALITY_MANAGER', async () => {
    const { service, capaFindMany, qualityTrendFlagUpsert, notificationCreate } = buildHarness()
    capaFindMany.mockResolvedValue([
      { id: 'c1', rootCauseCategory: 'packaging_defect' },
      { id: 'c2', rootCauseCategory: 'packaging_defect' },
      { id: 'c3', rootCauseCategory: 'packaging_defect' },
    ])

    const result = await service.scanAndFlag()

    expect(qualityTrendFlagUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          rootCauseCategory: 'packaging_defect',
          occurrenceCount: 3,
          capaIds: ['c1', 'c2', 'c3'],
        }),
      }),
    )
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'qm-1', recordType: 'quality_trend_flag' }),
    )
    expect(result.flagsOpened).toBe(1)
  })

  it('respects a company-level admin-editable threshold override', async () => {
    const { service, companyFindMany, capaFindMany, qualityTrendFlagUpsert } = buildHarness()
    companyFindMany.mockResolvedValue([
      { id: 'company-1', qualityTrendThresholdCount: 5, qualityTrendWindowDays: null },
    ])
    capaFindMany.mockResolvedValue([
      { id: 'c1', rootCauseCategory: 'packaging_defect' },
      { id: 'c2', rootCauseCategory: 'packaging_defect' },
      { id: 'c3', rootCauseCategory: 'packaging_defect' },
    ])

    await service.scanAndFlag()
    expect(qualityTrendFlagUpsert).not.toHaveBeenCalled()
  })

  it('does not re-notify for a category whose flag is already open, but does update the occurrence count', async () => {
    const { service, capaFindMany, qualityTrendFlagFindMany, notificationCreate, qualityTrendFlagUpsert } =
      buildHarness()
    qualityTrendFlagFindMany.mockResolvedValue([
      { id: 'flag-1', rootCauseCategory: 'packaging_defect', status: 'open' },
    ])
    capaFindMany.mockResolvedValue([
      { id: 'c1', rootCauseCategory: 'packaging_defect' },
      { id: 'c2', rootCauseCategory: 'packaging_defect' },
      { id: 'c3', rootCauseCategory: 'packaging_defect' },
      { id: 'c4', rootCauseCategory: 'packaging_defect' },
    ])

    const result = await service.scanAndFlag()
    expect(qualityTrendFlagUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ occurrenceCount: 4 }) }),
    )
    expect(notificationCreate).not.toHaveBeenCalled()
    expect(result.flagsOpened).toBe(0)
  })

  it('resolves a previously-open flag once its category no longer meets the threshold', async () => {
    const { service, qualityTrendFlagFindMany, capaFindMany, qualityTrendFlagUpdate } = buildHarness()
    qualityTrendFlagFindMany.mockResolvedValue([
      { id: 'flag-1', rootCauseCategory: 'packaging_defect', status: 'open' },
    ])
    capaFindMany.mockResolvedValue([{ id: 'c1', rootCauseCategory: 'packaging_defect' }])

    const result = await service.scanAndFlag()
    expect(qualityTrendFlagUpdate).toHaveBeenCalledWith({
      where: { id: 'flag-1' },
      data: { status: 'resolved' },
    })
    expect(result.flagsResolved).toBe(1)
  })
})

describe('QualityTrendDetectionService.list/acknowledge', () => {
  it('acknowledges an existing flag', async () => {
    const { service, qualityTrendFlagFindFirst, qualityTrendFlagUpdate } = buildHarness()
    qualityTrendFlagFindFirst.mockResolvedValue({ id: 'flag-1' })
    qualityTrendFlagUpdate.mockResolvedValue({ id: 'flag-1', acknowledgedBy: 'user-1' })

    const result = await service.acknowledge(actor, 'flag-1', {})
    expect(result.acknowledgedBy).toBe('user-1')
  })

  it('404s acknowledging a flag that does not exist', async () => {
    const { service, qualityTrendFlagFindFirst } = buildHarness()
    qualityTrendFlagFindFirst.mockResolvedValue(null)

    await expect(service.acknowledge(actor, 'ghost', {})).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })
})
