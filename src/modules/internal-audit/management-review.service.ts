import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ManagementReview, Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CapaService } from './capa.service'
import { RecordManagementReviewActionsDto } from './dto/record-management-review-actions.dto'
import { ScheduleManagementReviewDto } from './dto/schedule-management-review.dto'
import { QualityMetricsService } from './quality-metrics.service'

export interface RequestMeta {
  ip?: string
}

export const MANAGEMENT_REVIEW_RECORD_TYPE = 'management_review'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Management reviews are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 8 — ICH Q10's own management-review PQS
 * element. `schedule()` pulls a *live* metrics snapshot the moment the
 * review is scheduled and freezes it onto the row — 🧭 a management
 * review is a point-in-time record of what leadership actually saw and
 * decided on; re-computing it after the fact would silently rewrite
 * history, the opposite of ALCOA+'s "contemporaneous" principle
 * (`todo-qualcloud.md`'s own reasoning). `recordActions()` is a
 * separate, later step — the review has already happened; this is
 * where its agreed actions get written down, optionally opening real
 * CAPAs.
 */
@Injectable()
export class ManagementReviewService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly metricsService: QualityMetricsService,
    private readonly capaService: CapaService,
  ) {}

  async schedule(
    actor: AuthenticatedUser,
    dto: ScheduleManagementReviewDto,
    meta: RequestMeta,
  ): Promise<ManagementReview> {
    const companyId = requireCompany(actor)
    const reviewDate = new Date(dto.reviewDate)

    // A full rolling year up to the review date — the real period
    // leadership is actually reviewing, matching this feature's own
    // "quarterly cadence over a trailing window" framing rather than a
    // single day's snapshot.
    const from = new Date(reviewDate.getTime() - 365 * 24 * 60 * 60 * 1000)
    const metrics = await this.metricsService.compute(actor, { from, to: reviewDate })

    const openFlags = await this.rls.runAsCompany(companyId, (tx) =>
      tx.qualityTrendFlag.findMany({ where: { companyId, status: 'open' } }),
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.managementReview.create({
        data: {
          id: newId(),
          companyId,
          period: dto.period,
          reviewDate,
          attendees: dto.attendees ?? null,
          metricsSnapshot: metrics as unknown as Prisma.InputJsonValue,
          recurringIssueFlagsSnapshot: openFlags,
          nextReviewDueAt: dto.nextReviewDueAt ? new Date(dto.nextReviewDueAt) : null,
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'management_review_scheduled',
        recordType: MANAGEMENT_REVIEW_RECORD_TYPE,
        recordId: created.id,
        newValue: { period: dto.period, reviewDate: dto.reviewDate },
        ip: meta.ip,
      })

      return created
    })
  }

  async recordActions(
    actor: AuthenticatedUser,
    id: string,
    dto: RecordManagementReviewActionsDto,
    meta: RequestMeta,
  ): Promise<ManagementReview> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.managementReview.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Management review not found' })
      }

      const recordedActions = []
      for (const action of dto.actions) {
        let capaId: string | undefined
        if (action.openCapa) {
          const capa = await this.capaService.createFrom(
            tx,
            actor,
            companyId,
            MANAGEMENT_REVIEW_RECORD_TYPE,
            id,
            {
              title: action.description,
              correctiveAction: action.description,
              rootCauseCategory: action.rootCauseCategory,
              ownerUserId: action.ownerUserId,
            },
            meta,
          )
          capaId = capa.id
        }
        recordedActions.push({ ...action, capaId: capaId ?? null })
      }

      const updated = await tx.managementReview.update({
        where: { id },
        data: { actionsAgreed: recordedActions },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'management_review_actions_recorded',
        recordType: MANAGEMENT_REVIEW_RECORD_TYPE,
        recordId: id,
        newValue: { actionCount: recordedActions.length },
        ip: meta.ip,
      })

      return updated
    })
  }

  async list(actor: AuthenticatedUser): Promise<ManagementReview[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.managementReview.findMany({ where: { companyId }, orderBy: { reviewDate: 'desc' } }),
    )
  }

  async get(actor: AuthenticatedUser, id: string): Promise<ManagementReview> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.managementReview.findFirst({ where: { id, companyId } })
      if (!found) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Management review not found' })
      }
      return found
    })
  }
}
