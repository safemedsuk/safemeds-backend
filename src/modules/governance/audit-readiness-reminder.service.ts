import { Injectable } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { TasksService } from '../tasks/tasks.service'
import { AuditReadinessService } from './audit-readiness.service'

export const AUDIT_REQUIREMENT_REMINDER_RECORD_TYPE = 'audit_requirement_reminder'

const REMINDER_INTERVAL_DAYS = 30

export interface AuditReadinessReminderResult {
  companiesScanned: number
  remindersCreated: number
}

/**
 * VigiCloud Stage 16.2 — "items needing a human become assigned Tasks
 * with reminders and escalation." Same "derive due-ness from `Task`
 * history, no parallel tracking column" pattern as
 * `ProductReviewReminderService`, but the due-ness signal here is "at
 * least one mandatory requirement isn't ready" rather than a fixed
 * calendar interval — the 30-day interval only throttles how often a
 * *repeat* reminder fires for a company still not fully ready, so one
 * genuinely stuck gap doesn't spam a fresh task every scan.
 */
@Injectable()
export class AuditReadinessReminderService {
  constructor(
    private readonly rls: RlsService,
    private readonly tasksService: TasksService,
    private readonly auditReadinessService: AuditReadinessService,
  ) {}

  async scanAndRemind(): Promise<AuditReadinessReminderResult> {
    const companies = await this.rls.runWithSystemAccess((tx) =>
      tx.company.findMany({ where: { status: 'active' }, select: { id: true } }),
    )

    let remindersCreated = 0
    const cutoff = new Date(Date.now() - REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000)

    for (const company of companies) {
      const isDue = await this.rls.runAsCompany(company.id, async (tx) => {
        const mostRecent = await tx.task.findFirst({
          where: { companyId: company.id, recordType: AUDIT_REQUIREMENT_REMINDER_RECORD_TYPE },
          orderBy: { createdAt: 'desc' },
        })
        return !mostRecent || mostRecent.createdAt < cutoff
      })
      if (!isDue) continue

      const systemActor: AuthenticatedUser = {
        sub: 'system',
        companyId: company.id,
        roleKeys: [],
        platformRole: null,
        tokenVersion: 0,
      }
      const dashboard = await this.auditReadinessService.getDashboard(systemActor)
      const notReady = dashboard.rows.filter((r) => r.isMandatory && r.status !== 'ready')
      if (notReady.length === 0) continue

      await this.tasksService.createForWorkflowState(
        {
          companyId: company.id,
          recordType: AUDIT_REQUIREMENT_REMINDER_RECORD_TYPE,
          recordId: company.id,
          title: `Audit readiness: ${notReady.length} mandatory requirement(s) not ready — ${notReady.map((r) => r.title).join(', ')}`,
          assignedRoleKey: 'QPPV',
        },
        {},
      )
      remindersCreated += 1
    }

    return { companiesScanned: companies.length, remindersCreated }
  }
}
