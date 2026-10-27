import { Injectable } from '@nestjs/common'

import { TextEncryptionService } from '../../common/encryption/text-encryption.service'
import { RlsService } from '../../common/rls/rls.service'
import { NotificationsService } from '../notifications/notifications.service'
import { TasksService } from '../tasks/tasks.service'
import { REG_QUERY_RECORD_TYPE } from './reg-query.service'

export const REG_QUERY_REMINDER_RECORD_TYPE = REG_QUERY_RECORD_TYPE

export interface RegQueryReminderResult {
  queriesScanned: number
  remindersSent: number
  escalationsSent: number
}

/**
 * CEO feedback, 30 Sep 2026 — "reminders before the due date, reusing
 * the registration-expiry reminders, then an escalation to a manager
 * if it goes overdue." Mirrors `RegRenewalReminderService`'s own
 * "keeps firing every single scan while the condition holds" shape
 * exactly — a query naturally stops qualifying the moment it's
 * responded/closed. Scanned **daily**, not weekly: a query-response
 * clock moves in days/weeks, not months/years, the same "match the
 * scan cadence to the clock's own scale" call `RegDeadlineEscalationProcessor`'s
 * own doc comment already makes for the 180/90/30-day renewal engine —
 * a weekly-only scan on a deadline that can be a week away risks
 * firing zero times before it's missed.
 *
 * "Escalation to a manager" — this platform's real 8-role tenant
 * taxonomy has no distinct "Regulatory Manager" role (`REGULATORY_AFFAIRS_OFFICER`
 * is a single flat role, unlike QualCloud's Associate/Manager split) —
 * so the manager proxy is `TasksService.escalateForRecord()`'s own
 * already-established default: a `SYSTEM_ADMINISTRATOR`-queue task,
 * the same "whoever administers this tenant is the escalation
 * backstop" precedent this generic helper already applies everywhere
 * else in this codebase. Honestly documented, not silently guessed —
 * matching this project's own "no role invented without a real fit"
 * discipline (see Stage 4's Change Control write-up on the same
 * question).
 */
@Injectable()
export class RegQueryReminderService {
  constructor(
    private readonly rls: RlsService,
    private readonly notificationsService: NotificationsService,
    private readonly tasksService: TasksService,
    private readonly encryptionService: TextEncryptionService,
  ) {}

  async scanAndRemind(): Promise<RegQueryReminderResult> {
    const now = new Date()

    const dueQueries = await this.rls.runWithSystemAccess((tx) =>
      tx.regQuery.findMany({
        where: {
          status: { in: ['open', 'in_progress'] },
          responseDueDate: { not: null },
        },
        include: {
          company: { select: { regulatoryContactEmail: true } },
          owner: { select: { id: true, email: true, status: true } },
        },
      }),
    )

    let remindersSent = 0
    let escalationsSent = 0

    for (const query of dueQueries) {
      const dueDate = query.responseDueDate!
      const overdue = dueDate.getTime() < now.getTime()
      const queryPreview = this.encryptionService.decrypt(query.queryTextEncrypted).slice(0, 80)
      const dueLabel = dueDate.toISOString().slice(0, 10)

      const title = overdue
        ? `Overdue regulator query — due ${dueLabel}`
        : `Regulator query due ${dueLabel}`
      const body = overdue
        ? `A regulator query ("${queryPreview}...") is now overdue — the response deadline of ${dueLabel} has passed with no response on file.`
        : `A regulator query ("${queryPreview}...") is due ${dueLabel}. Respond before the deadline.`

      // In-app notification: the owner if one exists and is still
      // active, else every `regulatory.manage_dossier`-holding user —
      // mirroring `RegRenewalReminderService`'s own team-wide fallback.
      const recipients =
        query.owner && query.owner.status === 'active'
          ? [query.owner]
          : await this.rls.runAsCompany(query.companyId, (tx) =>
              tx.user.findMany({
                where: {
                  companyId: query.companyId,
                  roleKeys: { has: 'REGULATORY_AFFAIRS_OFFICER' },
                  status: 'active',
                },
                select: { id: true, email: true },
              }),
            )

      for (const recipient of recipients) {
        await this.notificationsService.create({
          companyId: query.companyId,
          userId: recipient.id,
          category: overdue ? 'deadline_approaching' : 'deadline_approaching',
          title,
          body,
          type: 'reg_query_reminder',
          params: { overdue, dueLabel, queryPreview },
          recordType: REG_QUERY_REMINDER_RECORD_TYPE,
          recordId: query.id,
        })
      }

      if (overdue) {
        // The real "escalation to a manager" — see this service's own
        // doc comment above for why `SYSTEM_ADMINISTRATOR` is the
        // honest proxy for "manager" in this platform's real role
        // taxonomy.
        await this.tasksService.escalateForRecord(
          query.companyId,
          REG_QUERY_REMINDER_RECORD_TYPE,
          query.id,
          'overdue',
          title,
          {},
        )
        if (query.company.regulatoryContactEmail) {
          await this.notificationsService.sendExternalEmail(
            query.company.regulatoryContactEmail,
            title,
            `${body} Please respond and log it in SafeMeds as soon as possible.`,
          )
        }
        escalationsSent += 1
      } else {
        remindersSent += 1
      }
    }

    return { queriesScanned: dueQueries.length, remindersSent, escalationsSent }
  }
}
