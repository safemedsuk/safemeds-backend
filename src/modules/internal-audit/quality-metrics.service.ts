import { ForbiddenException, Injectable } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { computeTrainingStatus } from '../training/training-record.service'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Quality metrics are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

export interface QualityMetricsPeriod {
  from: Date
  to: Date
}

export interface OosRateRow {
  productId: string
  brandName: string
  oosCount: number
  batchCount: number
  /** Null when no batches were manufactured for this product in the period — a rate with a zero denominator is meaningless, not zero. */
  ratePercent: number | null
}

export interface QualityMetricsSnapshot {
  periodStart: string
  periodEnd: string
  deviationsOpened: number
  deviationsClosed: number
  complaintsOpened: number
  complaintsClosed: number
  capasOpened: number
  capasClosed: number
  /**
   * 🧭 `= closed-without-reopening ÷ total closed` (`todo-qualcloud.md`'s
   * own Stage 8 definition) — this schema has no generic "reopened"
   * event, so `Capa.flaggedRecurring` (set only when a *new* quality
   * event links back to a CAPA already closed `effective` within 12
   * months, sharing the same root-cause category — the literal signal
   * that the first fix didn't actually work) is the honest, defensible
   * proxy: a CAPA closed *without* ever being flagged recurring is a
   * real "right first time" outcome. Null when no CAPA closed in the
   * period — a 0% floor would misleadingly read as "always fails."
   */
  rightFirstTimeRate: number | null
  /** Live, not period-scoped — "how many CAPAs are overdue right now." */
  overdueCapaCount: number
  recurringIssueCount: number
  oosRatePerProduct: OosRateRow[]
  /** Live, org-wide — the same `valid`/`expiring`/`expired` computation `TrainingRecord.computedStatus` already establishes, reused rather than re-derived. */
  trainingComplianceRate: number | null
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * QualCloud (Phase 13) Stage 8 — `QualityMetricsService`: live-computed
 * (never cached, matching `DashboardService`'s own established
 * discipline everywhere else in this codebase).
 */
@Injectable()
export class QualityMetricsService {
  constructor(private readonly rls: RlsService) {}

  async compute(
    actor: AuthenticatedUser,
    period: QualityMetricsPeriod,
  ): Promise<QualityMetricsSnapshot> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const { from, to } = period
      const now = new Date()

      const [
        deviationsOpened,
        deviationsClosed,
        complaintsOpened,
        complaintsClosed,
        capasOpened,
        capasClosedRows,
        overdueCapaCount,
        recurringIssueCount,
      ] = await Promise.all([
        tx.deviation.count({ where: { companyId, detectedAt: { gte: from, lte: to } } }),
        tx.deviation.count({
          where: { companyId, status: 'closed', closedAt: { gte: from, lte: to } },
        }),
        tx.complaint.count({ where: { companyId, createdAt: { gte: from, lte: to } } }),
        tx.complaint.count({
          where: { companyId, status: 'resolved', resolvedAt: { gte: from, lte: to } },
        }),
        tx.capa.count({ where: { companyId, createdAt: { gte: from, lte: to } } }),
        tx.capa.findMany({
          where: { companyId, status: 'closed', closedAt: { gte: from, lte: to } },
          select: { flaggedRecurring: true },
        }),
        tx.capa.count({ where: { companyId, status: { not: 'closed' }, dueDate: { lt: now } } }),
        tx.capa.count({
          where: { companyId, flaggedRecurring: true, createdAt: { gte: from, lte: to } },
        }),
      ])

      const capasClosed = capasClosedRows.length
      const rightFirstTimeRate =
        capasClosed > 0
          ? round1(
              (capasClosedRows.filter((c) => !c.flaggedRecurring).length / capasClosed) * 100,
            )
          : null

      const [oosRows, batchRows, trainingRows] = await Promise.all([
        tx.oos.findMany({
          where: { companyId, createdAt: { gte: from, lte: to } },
          include: { batch: { select: { productId: true } } },
        }),
        tx.batch.findMany({
          where: { companyId, manufacturedOn: { gte: from, lte: to } },
          select: { productId: true },
        }),
        tx.trainingRecord.findMany({ where: { companyId }, select: { expiryDate: true } }),
      ])

      const oosCountByProduct = new Map<string, number>()
      for (const row of oosRows) {
        oosCountByProduct.set(
          row.batch.productId,
          (oosCountByProduct.get(row.batch.productId) ?? 0) + 1,
        )
      }
      const batchCountByProduct = new Map<string, number>()
      for (const row of batchRows) {
        batchCountByProduct.set(row.productId, (batchCountByProduct.get(row.productId) ?? 0) + 1)
      }
      const affectedProductIds = new Set([
        ...oosCountByProduct.keys(),
        ...batchCountByProduct.keys(),
      ])
      const products =
        affectedProductIds.size > 0
          ? await tx.product.findMany({
              where: { id: { in: Array.from(affectedProductIds) } },
              select: { id: true, brandName: true },
            })
          : []
      const oosRatePerProduct: OosRateRow[] = products
        .map((product) => {
          const oosCount = oosCountByProduct.get(product.id) ?? 0
          const batchCount = batchCountByProduct.get(product.id) ?? 0
          return {
            productId: product.id,
            brandName: product.brandName,
            oosCount,
            batchCount,
            ratePercent: batchCount > 0 ? round1((oosCount / batchCount) * 100) : null,
          }
        })
        .sort((a, b) => b.oosCount - a.oosCount)

      const compliantCount = trainingRows.filter(
        (r) => computeTrainingStatus(r.expiryDate) === 'valid',
      ).length
      const trainingComplianceRate =
        trainingRows.length > 0 ? round1((compliantCount / trainingRows.length) * 100) : null

      return {
        periodStart: from.toISOString().slice(0, 10),
        periodEnd: to.toISOString().slice(0, 10),
        deviationsOpened,
        deviationsClosed,
        complaintsOpened,
        complaintsClosed,
        capasOpened,
        capasClosed,
        rightFirstTimeRate,
        overdueCapaCount,
        recurringIssueCount,
        oosRatePerProduct,
        trainingComplianceRate,
      }
    })
  }
}
