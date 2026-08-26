import { ForbiddenException, Injectable } from '@nestjs/common'
import { RegDeadline } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { ListRegDeadlinesQueryDto } from './dto/list-reg-deadlines-query.dto'
import { RegConfigService } from './reg-config.service'
import { addInterval } from './reg-deadline-date.util'
import { RegDeadlineEscalationNotifier } from './reg-deadline-escalation.interface'

export interface ComputeRegDeadlineInput {
  companyId: string
  recordType: string
  recordId: string
  countryId: string
  authorityId: string
  productClass: string
  obligationType: string
  /** The clock-start date — the caller always supplies the real one explicitly (`issuedOn` for a `renewal` obligation, Stage 5's `RegQuery.receivedDate` for a `query_response` obligation); `RegDeadlineRule.clockStart` is purely descriptive metadata, never read here. */
  triggerDate: Date
  /** Null for a system-triggered recompute (e.g. a future scheduled reconciliation); set for the common case, a user's own create/update action. */
  actorUserId?: string | null
}

const NOTIFY_180D_MS = 180 * 24 * 60 * 60 * 1000
const NOTIFY_90D_MS = 90 * 24 * 60 * 60 * 1000
const NOTIFY_30D_MS = 30 * 24 * 60 * 60 * 1000

/**
 * RegCloud (Phase 12) Stage 0.4 — the Renewal & Variation Deadline
 * Engine's own computation/escalation half, structurally mirroring
 * `DeadlineService` (`src/modules/workflow/deadline.service.ts`) but never
 * touching that PV-specific table — `Deadline.reportingRuleId` is a
 * required, non-nullable FK straight to `ReportingRule`, so there is no
 * schema-safe way to point a `Deadline` row at a `RegDeadlineRule`
 * instead. `RegDeadline` is the sibling table this genuinely needs, kept
 * deliberately parallel to `Deadline` in every other way (same
 * `t72NotifiedAt`-style "never double-notify" pattern, just day-scale
 * thresholds — 180/90/30 days — appropriate to a multi-year renewal
 * window instead of a multi-day ADR reporting clock).
 *
 * Unlike `DeadlineService.computeFor()`, this never throws when no rule
 * resolves — it's called as a passive side effect of ordinary
 * `ProductRegistration` create/update (`MasterDataService`), and most
 * markets genuinely have no `RegDeadlineRule` configured yet (only Kenya's
 * real 5-year cadence is seeded so far). A registration in an
 * unconfigured market is still created successfully; it just has no
 * `RegDeadline` tracking it yet, exactly the same graceful-degradation
 * shape `RegConfigService.resolveRequirement()` already follows.
 */
@Injectable()
export class RegDeadlineService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly regConfigService: RegConfigService,
  ) {}

  /**
   * Resolves the active rule and upserts the `(recordType, recordId)`
   * deadline row — safe to call on both create and update (e.g. a
   * registration's `issuedOn` changing) since the unique index makes this
   * a real recompute-in-place, matching `Deadline.recompute()`'s own
   * "update, don't accumulate rows" precedent.
   */
  async computeOrRecompute(input: ComputeRegDeadlineInput): Promise<RegDeadline | null> {
    const rule = await this.regConfigService.resolveDeadlineRule(
      input.countryId,
      input.authorityId,
      input.productClass,
      input.obligationType,
    )
    if (!rule) return null

    const dueAt = addInterval(
      input.triggerDate,
      rule.intervalValue,
      rule.intervalUnit as 'days' | 'months' | 'years',
    )

    return this.rls.runAsCompany(input.companyId, async (tx) => {
      const existing = await tx.regDeadline.findUnique({
        where: { recordType_recordId: { recordType: input.recordType, recordId: input.recordId } },
      })

      const saved = await tx.regDeadline.upsert({
        where: { recordType_recordId: { recordType: input.recordType, recordId: input.recordId } },
        create: {
          id: newId(),
          companyId: input.companyId,
          recordType: input.recordType,
          recordId: input.recordId,
          regDeadlineRuleId: rule.id,
          dueAt,
          status: 'pending',
        },
        update: {
          regDeadlineRuleId: rule.id,
          dueAt,
          status: 'pending',
          // A recompute clears prior escalation state — the new due date
          // may no longer be within a threshold that already fired,
          // matching `Deadline.recompute()`'s own "status: recalculated"
          // treatment of clearing stale escalation.
          notifiedAt180d: null,
          notifiedAt90d: null,
          notifiedAt30d: null,
          breachedAt: null,
        },
      })

      await this.auditService.log(tx, {
        companyId: input.companyId,
        actorUserId: input.actorUserId ?? null,
        actorType: input.actorUserId ? 'user' : 'system',
        action: existing ? 'reg_deadline_recomputed' : 'reg_deadline_computed',
        recordType: input.recordType,
        recordId: input.recordId,
        oldValue: existing ? { dueAt: existing.dueAt.toISOString() } : undefined,
        newValue: { deadlineId: saved.id, dueAt: dueAt.toISOString(), regDeadlineRuleId: rule.id },
      })

      return saved
    })
  }

  async list(
    actor: AuthenticatedUser,
    query: ListRegDeadlinesQueryDto,
  ): Promise<PaginatedResult<RegDeadline>> {
    if (!actor.companyId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Listing deadlines requires a tenant-scoped actor',
      })
    }
    return this.rls.runAsCompany(actor.companyId, async (tx) => {
      const where = {
        companyId: actor.companyId!,
        ...(query.status ? { status: query.status } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.regDeadline.findMany({
          where,
          orderBy: { dueAt: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.regDeadline.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  /** Day-scale escalation scan — the periodic BullMQ job's actual work. */
  async scanAndEscalate(
    notifier: RegDeadlineEscalationNotifier,
  ): Promise<{ breached: number; d180: number; d90: number; d30: number }> {
    const now = new Date()

    const { overdue, approaching180, approaching90, approaching30 } =
      await this.rls.runWithSystemAccess(async (tx) => {
        const overdue = await tx.regDeadline.findMany({
          where: { status: 'pending', dueAt: { lt: now } },
        })
        for (const deadline of overdue) {
          await tx.regDeadline.update({
            where: { id: deadline.id },
            data: { status: 'missed', breachedAt: now },
          })
          await this.auditService.log(tx, {
            companyId: deadline.companyId,
            actorType: 'system',
            action: 'reg_deadline_missed',
            recordType: deadline.recordType,
            recordId: deadline.recordId,
            newValue: { deadlineId: deadline.id, dueAt: deadline.dueAt.toISOString() },
          })
        }

        const t30 = new Date(now.getTime() + NOTIFY_30D_MS)
        const approaching30 = await tx.regDeadline.findMany({
          where: { status: 'pending', dueAt: { gte: now, lte: t30 }, notifiedAt30d: null },
        })
        for (const d of approaching30)
          await tx.regDeadline.update({ where: { id: d.id }, data: { notifiedAt30d: now } })

        const t90 = new Date(now.getTime() + NOTIFY_90D_MS)
        const approaching90 = await tx.regDeadline.findMany({
          where: { status: 'pending', dueAt: { gt: t30, lte: t90 }, notifiedAt90d: null },
        })
        for (const d of approaching90)
          await tx.regDeadline.update({ where: { id: d.id }, data: { notifiedAt90d: now } })

        const t180 = new Date(now.getTime() + NOTIFY_180D_MS)
        const approaching180 = await tx.regDeadline.findMany({
          where: { status: 'pending', dueAt: { gt: t90, lte: t180 }, notifiedAt180d: null },
        })
        for (const d of approaching180)
          await tx.regDeadline.update({ where: { id: d.id }, data: { notifiedAt180d: now } })

        return { overdue, approaching180, approaching90, approaching30 }
      })

    for (const deadline of overdue) await notifier.onBreach(deadline)
    for (const deadline of approaching30) await notifier.onApproaching(deadline, '30d')
    for (const deadline of approaching90) await notifier.onApproaching(deadline, '90d')
    for (const deadline of approaching180) await notifier.onApproaching(deadline, '180d')

    return {
      breached: overdue.length,
      d180: approaching180.length,
      d90: approaching90.length,
      d30: approaching30.length,
    }
  }
}
