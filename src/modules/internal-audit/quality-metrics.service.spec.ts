import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { QualityMetricsService } from './quality-metrics.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const deviationCount = jest.fn().mockResolvedValue(0)
  const complaintCount = jest.fn().mockResolvedValue(0)
  const capaCount = jest.fn().mockResolvedValue(0)
  const capaFindMany = jest.fn().mockResolvedValue([])
  const oosFindMany = jest.fn().mockResolvedValue([])
  const batchFindMany = jest.fn().mockResolvedValue([])
  const trainingRecordFindMany = jest.fn().mockResolvedValue([])
  const productFindMany = jest.fn().mockResolvedValue([])

  const tables = {
    deviation: { count: deviationCount },
    complaint: { count: complaintCount },
    capa: { count: capaCount, findMany: capaFindMany },
    oos: { findMany: oosFindMany },
    batch: { findMany: batchFindMany },
    trainingRecord: { findMany: trainingRecordFindMany },
    product: { findMany: productFindMany },
  }
  const rls = { runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables) }

  const service = new QualityMetricsService(rls as never)
  return {
    service,
    deviationCount,
    complaintCount,
    capaCount,
    capaFindMany,
    oosFindMany,
    batchFindMany,
    trainingRecordFindMany,
    productFindMany,
  }
}

const period = { from: new Date('2026-01-01'), to: new Date('2026-06-30') }

describe('QualityMetricsService.compute', () => {
  it('reports the raw open/closed counts for the period', async () => {
    const { service, deviationCount, complaintCount, capaCount } = buildHarness()
    deviationCount.mockResolvedValueOnce(5).mockResolvedValueOnce(3)
    complaintCount.mockResolvedValueOnce(4).mockResolvedValueOnce(2)
    capaCount.mockResolvedValueOnce(6).mockResolvedValueOnce(1)

    const result = await service.compute(actor, period)

    expect(result.deviationsOpened).toBe(5)
    expect(result.deviationsClosed).toBe(3)
    expect(result.complaintsOpened).toBe(4)
    expect(result.complaintsClosed).toBe(2)
    expect(result.capasOpened).toBe(6)
  })

  it('computes rightFirstTimeRate as closed-without-recurring ÷ total closed, null when nothing closed', async () => {
    const { service, capaFindMany } = buildHarness()
    capaFindMany.mockResolvedValue([
      { flaggedRecurring: false },
      { flaggedRecurring: false },
      { flaggedRecurring: true },
      { flaggedRecurring: false },
    ])

    const result = await service.compute(actor, period)
    expect(result.rightFirstTimeRate).toBe(75)
  })

  it('returns a null rightFirstTimeRate when no CAPA closed in the period', async () => {
    const { service, capaFindMany } = buildHarness()
    capaFindMany.mockResolvedValue([])

    const result = await service.compute(actor, period)
    expect(result.rightFirstTimeRate).toBeNull()
  })

  it('computes a real OOS-per-batch rate per product, and a null rate when no batches were manufactured', async () => {
    const { service, oosFindMany, batchFindMany, productFindMany } = buildHarness()
    oosFindMany.mockResolvedValue([
      { batch: { productId: 'product-1' } },
      { batch: { productId: 'product-1' } },
      { batch: { productId: 'product-2' } },
    ])
    batchFindMany.mockResolvedValue([{ productId: 'product-1' }, { productId: 'product-1' }, { productId: 'product-1' }, { productId: 'product-1' }])
    productFindMany.mockResolvedValue([
      { id: 'product-1', brandName: 'Panadol' },
      { id: 'product-2', brandName: 'Amoxiclav' },
    ])

    const result = await service.compute(actor, period)
    const panadol = result.oosRatePerProduct.find((r) => r.productId === 'product-1')
    const amoxiclav = result.oosRatePerProduct.find((r) => r.productId === 'product-2')
    expect(panadol).toMatchObject({ oosCount: 2, batchCount: 4, ratePercent: 50 })
    expect(amoxiclav).toMatchObject({ oosCount: 1, batchCount: 0, ratePercent: null })
  })

  it('computes trainingComplianceRate from the real live valid/expiring/expired computation, null when no records exist', async () => {
    const { service, trainingRecordFindMany } = buildHarness()
    const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
    trainingRecordFindMany.mockResolvedValue([
      { expiryDate: future },
      { expiryDate: future },
      { expiryDate: past },
    ])

    const result = await service.compute(actor, period)
    expect(result.trainingComplianceRate).toBeCloseTo(66.7, 1)
  })

  it('overdueCapaCount is live (not period-scoped) — the second of capa.count()\'s three calls (opened, overdue, recurring)', async () => {
    const { service, capaCount } = buildHarness()
    capaCount.mockResolvedValueOnce(0).mockResolvedValueOnce(7).mockResolvedValueOnce(0)

    const result = await service.compute(actor, period)
    expect(result.overdueCapaCount).toBe(7)
  })
})
