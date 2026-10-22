import { Injectable } from '@nestjs/common'

import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CAPA_CLOSE_PERMISSION } from '../internal-audit/capa-allocation'
import { NotificationsService } from '../notifications/notifications.service'
import { QUALITY_DEVIATION_RECORD_TYPE } from './deviation.service'

/** Days before `investigationDueAt` at which the "approaching" reminder fires. */
export const INVESTIGATION_REMINDER_LEAD_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000

export type InvestigationReminderStage = 'approaching' | 'overdue'

/**
 * QualCloud Phase 1 Pass A2 (item 5b) — the daily scan that reminds the
 * person running a deviation investigation that it is approaching its due
 * date (3 days ahead) or has passed it.
 *
 * Idempotency mechanism (a stored stage, not audit-derived): each deviation
 * row carries `investigationReminderStage`, the furthest stage already
 * reminded for the current `investigationDueAt`. The scan only fires when the
 * target stage is further along than what is stored, so a stage is never sent
 * twice. Re-classification writes a new due date and resets the stage to null
 * (see `QualityWorkflowGuards`). The stage is written before the notifications
 * go out, so a crash can cause a missed reminder but never a daily repeat.
 *
 * Recipients: the investigator if one is recorded, else the deviation's
 * `raisedBy` user, else every active user holding `quality.close_capa`.
 * Email goes through the existing notification email path, honouring each
 * user's own deadline-email preference (on by default).
 */
@Injectable()
export class DeviationInvestigationReminderService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Pure — the stage a deviation should be at right now, or null when no reminder is due. */
  static targetStage(dueAt: Date, now: Date): InvestigationReminderStage | null {
    if (now.getTime() >= dueAt.getTime()) return 'overdue'
    if (dueAt.getTime() - now.getTime() <= INVESTIGATION_REMINDER_LEAD_DAYS * DAY_MS)
      return 'approaching'
    return null
  }

  /** Whether `target` is strictly further along than `stored` (approaching < overdue). */
  static isNewStage(stored: string | null, target: InvestigationReminderStage): boolean {
    if (stored === null) return true
    return stored === 'approaching' && target === 'overdue'
  }

  async scan(now = new Date()): Promise<{ scanned: number; remindersSent: number }> {
    const candidates = await this.rls.runWithSystemAccess((tx) =>
      tx.deviation.findMany({
        where: { status: 'investigating', investigationDueAt: { not: null } },
        include: { investigation: { select: { investigatorUserId: true } } },
      }),
    )

    let remindersSent = 0
    for (const deviation of candidates) {
      const dueAt = deviation.investigationDueAt
      if (!dueAt) continue
      const target = DeviationInvestigationReminderService.targetStage(dueAt, now)
      if (!target) continue
      if (
        !DeviationInvestigationReminderService.isNewStage(
          deviation.investigationReminderStage,
          target,
        )
      ) {
        continue
      }

      const recipientIds = await this.resolveRecipients(
        deviation.companyId,
        deviation.investigation?.investigatorUserId ?? null,
        deviation.raisedBy,
      )

      // Stage first (at-most-once), then notify.
      await this.rls.runAsCompany(deviation.companyId, async (tx) => {
        await tx.deviation.update({
          where: { id: deviation.id },
          data: { investigationReminderStage: target },
        })
        await this.auditService.log(tx, {
          companyId: deviation.companyId,
          actorType: 'system',
          action: 'deviation_investigation_reminder_sent',
          recordType: QUALITY_DEVIATION_RECORD_TYPE,
          recordId: deviation.id,
          newValue: {
            stage: target,
            investigationDueAt: dueAt,
            recipientUserIds: recipientIds,
          },
        })
      })

      const title =
        target === 'overdue'
          ? `Investigation overdue: ${deviation.deviationNumber}`
          : `Investigation due soon: ${deviation.deviationNumber}`
      const body =
        target === 'overdue'
          ? `The investigation for "${deviation.title}" was due on ${dueAt.toISOString().slice(0, 10)} and has not been completed.`
          : `The investigation for "${deviation.title}" is due on ${dueAt.toISOString().slice(0, 10)}.`

      for (const userId of recipientIds) {
        const user = await this.rls.runWithSystemAccess((tx) =>
          tx.user.findUnique({ where: { id: userId }, select: { email: true } }),
        )
        await this.notificationsService.create({
          companyId: deviation.companyId,
          userId,
          category: target === 'overdue' ? 'deadline_breached' : 'deadline_approaching',
          title,
          body,
          recordType: QUALITY_DEVIATION_RECORD_TYPE,
          recordId: deviation.id,
          email: user ? { to: user.email } : undefined,
        })
      }
      remindersSent += 1
    }

    return { scanned: candidates.length, remindersSent }
  }

  private async resolveRecipients(
    companyId: string,
    investigatorUserId: string | null,
    raisedBy: string | null,
  ): Promise<string[]> {
    if (investigatorUserId) return [investigatorUserId]
    if (raisedBy) return [raisedBy]
    return this.rls.runWithSystemAccess(async (tx) => {
      const roles = await tx.role.findMany({
        where: { permissions: { some: { permission: { key: CAPA_CLOSE_PERMISSION } } } },
        select: { key: true },
      })
      if (roles.length === 0) return []
      const users = await tx.user.findMany({
        where: { companyId, status: 'active', roleKeys: { hasSome: roles.map((r) => r.key) } },
        select: { id: true },
      })
      return users.map((u) => u.id)
    })
  }
}
