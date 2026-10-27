import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { QualityTrendFlag } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Quality trend flags are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

const DEFAULT_TREND_THRESHOLD_COUNT = 3
const DEFAULT_TREND_WINDOW_DAYS = 180

export interface QualityTrendScanResult {
  companiesScanned: number
  flagsOpened: number
  flagsResolved: number
}

/**
 * QualCloud (Phase 13) Stage 8 — "3 or more of the same root-cause
 * category within a rolling 6 months flags a trend" (`todo-qualcloud.md`).
 * Runs across every company daily, upserting one `QualityTrendFlag` row
 * per `(companyId, rootCauseCategory)` — matching this schema's own
 * "upsert on natural key, never delete-then-recreate" discipline. A
 * flag that no longer meets the threshold (the trend cleared —
 * CAPAs aged out of the rolling window) is marked `resolved`, never
 * deleted, so its own history stays visible.
 */
@Injectable()
export class QualityTrendDetectionService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async scanAndFlag(): Promise<QualityTrendScanResult> {
    const companies = await this.rls.runWithSystemAccess((tx) =>
      tx.company.findMany({
        select: { id: true, qualityTrendThresholdCount: true, qualityTrendWindowDays: true },
      }),
    )

    let flagsOpened = 0
    let flagsResolved = 0

    for (const company of companies) {
      const threshold = company.qualityTrendThresholdCount ?? DEFAULT_TREND_THRESHOLD_COUNT
      const windowDays = company.qualityTrendWindowDays ?? DEFAULT_TREND_WINDOW_DAYS
      const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
      const windowEnd = new Date()

      const capasByCategory = await this.rls.runAsCompany(company.id, async (tx) => {
        const capas = await tx.capa.findMany({
          where: {
            companyId: company.id,
            rootCauseCategory: { not: null },
            createdAt: { gte: windowStart, lte: windowEnd },
          },
          select: { id: true, rootCauseCategory: true },
        })
        const byCategory = new Map<string, string[]>()
        for (const capa of capas) {
          const category = capa.rootCauseCategory!
          byCategory.set(category, [...(byCategory.get(category) ?? []), capa.id])
        }
        return byCategory
      })

      const existingFlags = await this.rls.runAsCompany(company.id, (tx) =>
        tx.qualityTrendFlag.findMany({ where: { companyId: company.id, status: 'open' } }),
      )

      for (const [category, capaIds] of capasByCategory.entries()) {
        if (capaIds.length < threshold) continue

        const alreadyOpen = existingFlags.some((f) => f.rootCauseCategory === category)

        const flagId = await this.rls.runAsCompany(company.id, async (tx) => {
          const flag = await tx.qualityTrendFlag.upsert({
            where: {
              companyId_rootCauseCategory: { companyId: company.id, rootCauseCategory: category },
            },
            create: {
              id: newId(),
              companyId: company.id,
              rootCauseCategory: category,
              occurrenceCount: capaIds.length,
              capaIds,
              windowStart,
              windowEnd,
              status: 'open',
            },
            update: {
              occurrenceCount: capaIds.length,
              capaIds,
              windowStart,
              windowEnd,
              status: 'open',
            },
          })

          await this.auditService.log(tx, {
            companyId: company.id,
            actorType: 'system',
            action: alreadyOpen ? 'quality_trend_flag_updated' : 'quality_trend_flag_opened',
            recordType: 'quality_trend_flag',
            recordId: flag.id,
            newValue: { rootCauseCategory: category, occurrenceCount: capaIds.length },
          })
          return flag.id
        })

        if (!alreadyOpen) {
          flagsOpened += 1
          const recipients = await this.rls.runAsCompany(company.id, (tx) =>
            tx.user.findMany({
              where: {
                companyId: company.id,
                roleKeys: { has: 'QUALITY_MANAGER' },
                status: 'active',
              },
              select: { id: true },
            }),
          )
          for (const recipient of recipients) {
            await this.notificationsService.create({
              companyId: company.id,
              userId: recipient.id,
              category: 'workflow_update',
              title: `Quality trend detected: ${category}`,
              body: `${capaIds.length} CAPAs sharing root cause "${category}" have been opened within the last ${windowDays} days.`,
              type: 'quality_trend_detected',
              params: {
                category,
                capaCount: String(capaIds.length),
                windowDays: String(windowDays),
              },
              recordType: 'quality_trend_flag',
              recordId: flagId,
            })
          }
        }
      }

      // Any flag that no longer meets the threshold has genuinely
      // cleared — mark it resolved rather than deleting it, matching
      // this schema's "never delete, deactivate/resolve" convention.
      for (const flag of existingFlags) {
        const stillTrending =
          (capasByCategory.get(flag.rootCauseCategory)?.length ?? 0) >= threshold
        if (stillTrending) continue
        await this.rls.runAsCompany(company.id, async (tx) => {
          await tx.qualityTrendFlag.update({ where: { id: flag.id }, data: { status: 'resolved' } })
          await this.auditService.log(tx, {
            companyId: company.id,
            actorType: 'system',
            action: 'quality_trend_flag_resolved',
            recordType: 'quality_trend_flag',
            recordId: flag.id,
            newValue: { rootCauseCategory: flag.rootCauseCategory },
          })
        })
        flagsResolved += 1
      }
    }

    return { companiesScanned: companies.length, flagsOpened, flagsResolved }
  }

  async list(actor: AuthenticatedUser): Promise<QualityTrendFlag[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.qualityTrendFlag.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } }),
    )
  }

  async acknowledge(
    actor: AuthenticatedUser,
    id: string,
    meta: { ip?: string },
  ): Promise<QualityTrendFlag> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.qualityTrendFlag.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Trend flag not found' })
      }
      const updated = await tx.qualityTrendFlag.update({
        where: { id },
        data: { acknowledgedBy: actor.sub, acknowledgedAt: new Date() },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'quality_trend_flag_acknowledged',
        recordType: 'quality_trend_flag',
        recordId: id,
        ip: meta.ip,
      })
      return updated
    })
  }
}
