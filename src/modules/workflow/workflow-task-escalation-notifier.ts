import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Deadline } from '@prisma/client'

import { RlsService } from '../../common/rls/rls.service'
import { EnvConfig } from '../../config/env.validation'
import { NotificationsService } from '../notifications/notifications.service'
import { TasksService } from '../tasks/tasks.service'
import { DeadlineEscalationNotifier } from './deadline-escalation.interface'

/**
 * Phase 9's real implementation of the interface `DeadlineEscalationNotifier`
 * left behind in Phase 5.3 — see that interface's own doc comment.
 * Escalates the record's existing open task(s) (never piles up a second
 * task for the same thing — see `TasksService.escalateForRecord`) and
 * notifies whoever's actually on the hook: the specific assignee for a
 * personally-assigned task, or every user currently holding the role for
 * a role-queue task (small teams in practice, so fan-out here is bounded).
 */
@Injectable()
export class WorkflowTaskEscalationNotifier implements DeadlineEscalationNotifier {
  constructor(
    private readonly tasksService: TasksService,
    private readonly notificationsService: NotificationsService,
    private readonly rls: RlsService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  async onApproaching(deadline: Deadline, threshold: '72h' | '24h'): Promise<void> {
    // Both thresholds map to the same 'due_soon' task urgency — actual
    // escalation to 'overdue' is reserved for a real breach (onBreach
    // below); 72h vs 24h is preserved in the notification title/body
    // text so a human still knows how much runway is actually left.
    await this.escalate(
      deadline,
      'due_soon',
      `Reporting deadline approaching (${threshold})`,
      threshold,
    )
  }

  async onBreach(deadline: Deadline): Promise<void> {
    await this.escalate(deadline, 'overdue', 'Reporting deadline BREACHED')
  }

  private async escalate(
    deadline: Deadline,
    urgency: 'due_soon' | 'overdue',
    headline: string,
    threshold?: string,
  ): Promise<void> {
    const title = `${headline}: ${deadline.recordType} due ${deadline.dueAt.toISOString().slice(0, 10)}`

    await this.tasksService.escalateForRecord(
      deadline.companyId,
      deadline.recordType,
      deadline.recordId,
      urgency,
      title,
      {},
    )

    const recipients = await this.resolveRecipients(deadline)
    const appUrl = this.configService.get('FRONTEND_URL', { infer: true })
    const category = urgency === 'overdue' ? 'deadline_breached' : 'deadline_approaching'
    const dueDate = deadline.dueAt.toISOString().slice(0, 10)

    for (const recipient of recipients) {
      await this.notificationsService.create({
        companyId: deadline.companyId,
        userId: recipient.id,
        category,
        title,
        body: `${title}. Record: ${deadline.recordType}/${deadline.recordId}.`,
        type: 'workflow_deadline_escalation',
        params: {
          overdue: urgency === 'overdue',
          recordType: deadline.recordType,
          recordId: deadline.recordId,
          dueDate,
          threshold,
        },
        recordType: deadline.recordType,
        recordId: deadline.recordId,
        email: { to: recipient.email, actionUrl: `${appUrl}/tasks` },
      })
    }
  }

  /** Whoever's actually assigned/claimed on the record's currently-open task(s) — direct assignee, or every user holding the role-queue's role. */
  private async resolveRecipients(deadline: Deadline): Promise<{ id: string; email: string }[]> {
    return this.rls.runAsCompany(deadline.companyId, async (tx) => {
      const openTasks = await tx.task.findMany({
        where: {
          companyId: deadline.companyId,
          recordType: deadline.recordType,
          recordId: deadline.recordId,
          status: { in: ['open', 'claimed'] },
        },
      })

      const userIds = new Set<string>()
      const roleKeys = new Set<string>()
      for (const task of openTasks) {
        if (task.claimedBy) userIds.add(task.claimedBy)
        else if (task.assignedUserId) userIds.add(task.assignedUserId)
        else if (task.assignedRoleKey) roleKeys.add(task.assignedRoleKey)
      }

      const byId =
        userIds.size > 0
          ? await tx.user.findMany({
              where: { id: { in: [...userIds] } },
              select: { id: true, email: true },
            })
          : []
      const byRole =
        roleKeys.size > 0
          ? await tx.user.findMany({
              where: { companyId: deadline.companyId, roleKeys: { hasSome: [...roleKeys] } },
              select: { id: true, email: true },
            })
          : []

      const seen = new Map<string, { id: string; email: string }>()
      for (const u of [...byId, ...byRole]) seen.set(u.id, u)
      return [...seen.values()]
    })
  }
}
