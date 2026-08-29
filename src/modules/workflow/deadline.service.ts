import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Deadline, Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { RuleResolutionService } from '../country-config/rule-resolution.service'
import { addWindowDays } from './deadline-date.util'
import { DeadlineEscalationNotifier } from './deadline-escalation.interface'
import { ListDeadlinesQueryDto } from './dto/list-deadlines-query.dto'

export interface RequestMeta {
  ip?: string
}

export interface ComputeDeadlineInput {
  companyId: string
  recordType: string
  recordId: string
  authorityId: string
  reportTypeId: string
  seriousnessClass: string
  /** Clock start — "awareness date" per every PPB form's own convention (see `ReportingRule.clockStart`). */
  awarenessDate: Date
}

const T24_MS = 24 * 60 * 60 * 1000
const T72_MS = 72 * 60 * 60 * 1000

/**
 * Phase 5.3 — deadlines computed from Phase 4's `RuleResolutionService`
 * (never guessed, never computed client-side — see the system-wide
 * convention that all deadline-critical computation is server-side), plus
 * the escalation scan the hourly BullMQ job (`DeadlineEscalationProcessor`)
 * calls into.
 */
@Injectable()
export class DeadlineService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly ruleResolutionService: RuleResolutionService,
  ) {}

  async computeFor(
    actor: AuthenticatedUser,
    input: ComputeDeadlineInput,
    meta: RequestMeta,
  ): Promise<Deadline> {
    const rule = await this.ruleResolutionService.resolveReportingRule(
      input.authorityId,
      input.reportTypeId,
      input.seriousnessClass,
      input.awarenessDate,
    )
    if (!rule) {
      throw new NotFoundException({
        code: 'NO_ACTIVE_RULE',
        message:
          'No active reporting rule resolves for this authority/report type/seriousness class — cannot compute a legal deadline',
      })
    }
    // Belt-and-braces: `activateReportingRule` (Phase 4) already refuses to
    // activate an unverified rule, so this should be unreachable — but a
    // deadline is exactly the kind of number that must never be silently
    // wrong, so it's checked again here rather than trusted transitively.
    if (rule.unverified) {
      throw new ConflictException({
        code: 'RULE_UNVERIFIED',
        message: 'The resolved reporting rule is unverified',
      })
    }

    const dueAt = addWindowDays(input.awarenessDate, rule.windowDays, rule.dayType)

    return this.rls.runAsCompany(input.companyId, async (tx) => {
      const created = await tx.deadline.create({
        data: {
          id: newId(),
          companyId: input.companyId,
          recordType: input.recordType,
          recordId: input.recordId,
          reportingRuleId: rule.id,
          dueAt,
          status: 'pending',
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId: input.companyId,
        action: 'deadline_computed',
        recordType: input.recordType,
        recordId: input.recordId,
        newValue: { deadlineId: created.id, dueAt: dueAt.toISOString(), reportingRuleId: rule.id },
        ip: meta.ip,
      })

      return created
    })
  }

  /** Re-resolves the rule for a (possibly changed) seriousness class and records the old→new due date — the spec's "recompute() on seriousness reclassification". */
  async recompute(
    actor: AuthenticatedUser,
    deadlineId: string,
    newSeriousnessClass: string,
    awarenessDate: Date,
    meta: RequestMeta,
  ): Promise<Deadline> {
    if (!actor.companyId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Recomputing a deadline requires a tenant-scoped actor',
      })
    }

    return this.rls.runAsCompany(actor.companyId, async (tx) => {
      const existing = await tx.deadline.findUnique({
        where: { id: deadlineId },
        include: { reportingRule: true },
      })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Deadline not found' })
      }

      const rule = await this.ruleResolutionService.resolveReportingRule(
        existing.reportingRule.authorityId,
        existing.reportingRule.reportTypeId,
        newSeriousnessClass,
        awarenessDate,
      )
      if (!rule) {
        throw new NotFoundException({
          code: 'NO_ACTIVE_RULE',
          message: 'No active reporting rule resolves for the new seriousness class',
        })
      }

      const oldDueAt = existing.dueAt
      const newDueAt = addWindowDays(awarenessDate, rule.windowDays, rule.dayType)

      const updated = await tx.deadline.update({
        where: { id: deadlineId },
        data: { dueAt: newDueAt, reportingRuleId: rule.id, status: 'recalculated' },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId: existing.companyId,
        action: 'deadline_recomputed',
        recordType: existing.recordType,
        recordId: existing.recordId,
        oldValue: { dueAt: oldDueAt.toISOString(), reportingRuleId: existing.reportingRuleId },
        newValue: { dueAt: newDueAt.toISOString(), reportingRuleId: rule.id },
        ip: meta.ip,
      })

      return updated
    })
  }

  async list(
    actor: AuthenticatedUser,
    query: ListDeadlinesQueryDto,
  ): Promise<PaginatedResult<Deadline>> {
    if (!actor.companyId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Listing deadlines requires a tenant-scoped actor',
      })
    }

    return this.rls.runAsCompany(actor.companyId, async (tx) => {
      const where: Prisma.DeadlineWhereInput = {
        companyId: actor.companyId!,
        ...(query.status ? { status: query.status } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.deadline.findMany({
          where,
          orderBy: { dueAt: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.deadline.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  /**
   * The hourly BullMQ job's actual work: breach detection first (a deadline
   * that's already overdue is never also "approaching"), then the two
   * escalation thresholds. Each notification flag is set once and never
   * cleared, so re-running this scan (e.g. after a restart) never
   * double-notifies the same threshold for the same deadline.
   */
  async scanAndEscalate(
    notifier: DeadlineEscalationNotifier,
  ): Promise<{ breached: number; t24: number; t72: number }> {
    const now = new Date()

    // A background job scanning every tenant's deadlines is exactly
    // `runWithSystemAccess`'s intended use — narrow, no per-scan audit
    // noise (unlike `runWithPlatformAccess`, this isn't a human reading
    // another tenant's data on demand, it's the system's own scheduled
    // maintenance). Fixed alongside the rest of this file: none of these
    // queries ever set RLS context before, so against real FORCE-RLS
    // Postgres this method always saw zero rows — confirmed nothing ever
    // called it outside unit tests (which mock Prisma entirely), so this
    // was a live, previously-undetected bug, not just a style fix.
    const { overdue, approachingT24, approachingT72 } = await this.rls.runWithSystemAccess(
      async (tx) => {
        const overdue = await tx.deadline.findMany({
          where: { status: 'pending', dueAt: { lt: now } },
        })
        for (const deadline of overdue) {
          await tx.deadline.update({
            where: { id: deadline.id },
            data: { status: 'missed', breachedAt: now },
          })
          await this.auditService.log(tx, {
            companyId: deadline.companyId,
            actorType: 'system',
            action: 'deadline_missed',
            recordType: deadline.recordType,
            recordId: deadline.recordId,
            newValue: { deadlineId: deadline.id, dueAt: deadline.dueAt.toISOString() },
          })
        }

        const t24Threshold = new Date(now.getTime() + T24_MS)
        const approachingT24 = await tx.deadline.findMany({
          where: { status: 'pending', dueAt: { gte: now, lte: t24Threshold }, t24NotifiedAt: null },
        })
        for (const deadline of approachingT24) {
          await tx.deadline.update({ where: { id: deadline.id }, data: { t24NotifiedAt: now } })
        }

        const t72Threshold = new Date(now.getTime() + T72_MS)
        const approachingT72 = await tx.deadline.findMany({
          where: {
            status: 'pending',
            dueAt: { gt: t24Threshold, lte: t72Threshold },
            t72NotifiedAt: null,
          },
        })
        for (const deadline of approachingT72) {
          await tx.deadline.update({ where: { id: deadline.id }, data: { t72NotifiedAt: now } })
        }

        return { overdue, approachingT24, approachingT72 }
      },
    )

    // Notifier calls happen outside the system-access transaction — each
    // one internally scopes to its own deadline's company (see
    // `WorkflowTaskEscalationNotifier`), and a notification failure must
    // never roll back the status stamps above (those guarantee "never
    // double-notify"; losing one Task/email on a transient failure is a
    // smaller problem than re-escalating every deadline on every retry).
    for (const deadline of overdue) {
      await notifier.onBreach(deadline)
    }
    for (const deadline of approachingT24) {
      await notifier.onApproaching(deadline, '24h')
    }
    for (const deadline of approachingT72) {
      await notifier.onApproaching(deadline, '72h')
    }

    return { breached: overdue.length, t24: approachingT24.length, t72: approachingT72.length }
  }
}
