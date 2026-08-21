import { Injectable } from '@nestjs/common'

import { RlsService } from '../../common/rls/rls.service'
import { TasksService } from '../tasks/tasks.service'
import { LITERATURE_MONITORING_CURRENCY_WINDOW_DAYS } from './literature-monitoring.service'

export const LITERATURE_MONITORING_REMINDER_RECORD_TYPE = 'literature_monitoring_reminder'

export interface LiteratureMonitoringReminderResult {
  companiesScanned: number
  remindersCreated: number
}

/**
 * VigiCloud Stage 19 — "a monthly scheduled job... that records a
 * screening event" per the todo doc's own bullet; the *log itself* is
 * always manual (per the user's explicit instruction — never an API
 * search), but this job is what makes sure the reminder to go do one
 * actually happens. Same "derive due-ness from `Task` history, no
 * parallel tracking column" instinct `ProductReviewReminderService`
 * (Stage 2) already established, scanned per company like that one —
 * literature monitoring is a company-wide obligation, not tied to any
 * one case/product/trial.
 */
@Injectable()
export class LiteratureMonitoringReminderService {
  constructor(
    private readonly rls: RlsService,
    private readonly tasksService: TasksService,
  ) {}

  async scanAndRemind(): Promise<LiteratureMonitoringReminderResult> {
    const companies = await this.rls.runWithSystemAccess((tx) =>
      tx.company.findMany({ where: { status: 'active' }, select: { id: true } }),
    )

    let remindersCreated = 0
    const cutoff = new Date(
      Date.now() - LITERATURE_MONITORING_CURRENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    )

    for (const company of companies) {
      const isDue = await this.rls.runAsCompany(company.id, async (tx) => {
        const mostRecentReminder = await tx.task.findFirst({
          where: {
            companyId: company.id,
            recordType: LITERATURE_MONITORING_REMINDER_RECORD_TYPE,
            recordId: company.id,
          },
          orderBy: { createdAt: 'desc' },
        })
        if (mostRecentReminder && mostRecentReminder.createdAt >= cutoff) return false

        const mostRecentRun = await tx.literatureMonitoringRun.findFirst({
          where: { companyId: company.id },
          orderBy: { runAt: 'desc' },
        })
        return !mostRecentRun || mostRecentRun.runAt < cutoff
      })

      if (!isDue) continue

      await this.tasksService.createForWorkflowState(
        {
          companyId: company.id,
          recordType: LITERATURE_MONITORING_REMINDER_RECORD_TYPE,
          recordId: company.id,
          title:
            'Literature-monitoring screening due — log your latest search (PubMed or your own journal review) for the audit trail',
          assignedRoleKey: 'QPPV',
        },
        {},
      )
      remindersCreated += 1
    }

    return { companiesScanned: companies.length, remindersCreated }
  }
}
