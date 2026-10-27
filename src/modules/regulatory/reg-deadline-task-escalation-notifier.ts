import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { RegDeadline } from '@prisma/client'

import { RlsService } from '../../common/rls/rls.service'
import { EnvConfig } from '../../config/env.validation'
import { NotificationsService } from '../notifications/notifications.service'
import { TasksService } from '../tasks/tasks.service'
import { RegDeadlineEscalationNotifier } from './reg-deadline-escalation.interface'

/**
 * RegCloud (Phase 12) Stage 8/10/11 — `RegDeadline` is genuinely
 * polymorphic (`recordType`/`recordId`, no `WHERE recordType = ...`
 * filter anywhere in `scanAndEscalate()`'s own query), so every one of
 * these new stages' own deadlines (post-market obligations, facility/
 * personnel licence renewals, import/export permit expiry) is already
 * picked up by this same existing daily scan with zero new processor —
 * this map is the one real thing that needed to change: the headline
 * text was hardcoded to "Registration renewal" when only that one
 * `recordType` existed. Extend this map, not the scan/escalation
 * mechanism itself, whenever a future stage introduces a new
 * `RegDeadline` consumer.
 */
const RECORD_TYPE_LABELS: Record<string, string> = {
  reg_registration_renewal: 'Registration renewal',
  reg_query_response: 'Regulator query response',
  reg_post_market_obligation: 'Post-market obligation',
  facility_licence_renewal: 'Facility licence renewal',
  personnel_licence_renewal: 'Personnel licence renewal',
  import_export_permit_renewal: 'Import/export permit renewal',
}

function describeRecordType(recordType: string): string {
  return RECORD_TYPE_LABELS[recordType] ?? recordType.replace(/_/g, ' ')
}

/**
 * RegCloud's own real (never log-only) implementation, built directly
 * against the already-mature `TasksService`/`NotificationsService` — unlike
 * PV's `DeadlineEscalationNotifier`, which shipped a `LoggingDeadlineEscalationNotifier`
 * stopgap back when Phase 9 didn't exist yet, there is no equivalent need
 * here: Phase 9 has been complete since before RegCloud started.
 */
@Injectable()
export class RegDeadlineTaskEscalationNotifier implements RegDeadlineEscalationNotifier {
  constructor(
    private readonly tasksService: TasksService,
    private readonly notificationsService: NotificationsService,
    private readonly rls: RlsService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  async onApproaching(deadline: RegDeadline, threshold: '180d' | '90d' | '30d'): Promise<void> {
    await this.escalate(
      deadline,
      'due_soon',
      `${describeRecordType(deadline.recordType)} approaching (${threshold})`,
      threshold,
    )
  }

  async onBreach(deadline: RegDeadline): Promise<void> {
    await this.escalate(
      deadline,
      'overdue',
      `${describeRecordType(deadline.recordType)} deadline BREACHED`,
    )
  }

  private async escalate(
    deadline: RegDeadline,
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

    const recipients = await this.resolveRecipients(deadline.companyId)
    const appUrl = this.configService.get('FRONTEND_URL', { infer: true })
    const category = urgency === 'overdue' ? 'deadline_breached' : 'deadline_approaching'
    const dueDate = deadline.dueAt.toISOString().slice(0, 10)
    const recordTypeLabel = describeRecordType(deadline.recordType)

    for (const recipient of recipients) {
      await this.notificationsService.create({
        companyId: deadline.companyId,
        userId: recipient.id,
        category,
        title,
        body: `${title}. Record: ${deadline.recordType}/${deadline.recordId}.`,
        type: 'reg_deadline_escalation',
        params: {
          overdue: urgency === 'overdue',
          recordTypeLabel,
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

  /** Every user holding `REGULATORY_AFFAIRS_OFFICER` — there's no prior open-task assignee to poll the way `WorkflowTaskEscalationNotifier` does (a fresh `RegDeadline` has no pre-existing workflow task), so this goes straight to the role that owns registration renewals. */
  private async resolveRecipients(companyId: string): Promise<{ id: string; email: string }[]> {
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.user.findMany({
        where: { companyId, roleKeys: { has: 'REGULATORY_AFFAIRS_OFFICER' }, status: 'active' },
        select: { id: true, email: true },
      }),
    )
  }
}
