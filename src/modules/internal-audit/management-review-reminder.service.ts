import { Injectable } from '@nestjs/common'

import { RlsService } from '../../common/rls/rls.service'
import { NotificationsService } from '../notifications/notifications.service'
import { TasksService } from '../tasks/tasks.service'
import { MANAGEMENT_REVIEW_RECORD_TYPE } from './management-review.service'

export interface ManagementReviewReminderResult {
  companiesScanned: number
  remindersSent: number
}

const DEFAULT_CADENCE_DAYS = 90

/**
 * QualCloud (Phase 13) Stage 8 — "default quarterly for an active
 * manufacturer... reusing the exact `TasksService.escalateForRecord()`/
 * weekly-scan pattern already established everywhere else in this
 * codebase, never a new reminder mechanism" (`todo-qualcloud.md`'s own
 * wording). Due-ness is derived from the company's own most recent
 * `ManagementReview` — its `nextReviewDueAt` if one was set, else 90
 * days after its `reviewDate` — never a parallel tracking column,
 * matching `ProductReviewReminderService`'s own established precedent.
 * A company with no management review at all yet is treated as
 * immediately due — there is no "grace period" for never having held one.
 */
@Injectable()
export class ManagementReviewReminderService {
  constructor(
    private readonly rls: RlsService,
    private readonly notificationsService: NotificationsService,
    private readonly tasksService: TasksService,
  ) {}

  async scanAndRemind(): Promise<ManagementReviewReminderResult> {
    const companies = await this.rls.runWithSystemAccess((tx) =>
      tx.company.findMany({ select: { id: true } }),
    )
    const now = new Date()
    let remindersSent = 0

    for (const company of companies) {
      const latest = await this.rls.runAsCompany(company.id, (tx) =>
        tx.managementReview.findFirst({
          where: { companyId: company.id },
          orderBy: { reviewDate: 'desc' },
        }),
      )

      const dueAt = latest
        ? (latest.nextReviewDueAt ??
          new Date(latest.reviewDate.getTime() + DEFAULT_CADENCE_DAYS * 24 * 60 * 60 * 1000))
        : now

      if (dueAt.getTime() > now.getTime()) continue

      const title = 'Quarterly management review is due'
      await this.tasksService.escalateForRecord(
        company.id,
        MANAGEMENT_REVIEW_RECORD_TYPE,
        company.id,
        'due_soon',
        title,
        {},
      )

      const recipients = await this.rls.runAsCompany(company.id, (tx) =>
        tx.user.findMany({
          where: { companyId: company.id, roleKeys: { has: 'QUALITY_MANAGER' }, status: 'active' },
          select: { id: true },
        }),
      )
      for (const recipient of recipients) {
        await this.notificationsService.create({
          companyId: company.id,
          userId: recipient.id,
          category: 'deadline_approaching',
          title,
          body: 'Schedule the next management review from Quality → Metrics & Trends.',
          type: 'management_review_due',
          params: {},
          recordType: MANAGEMENT_REVIEW_RECORD_TYPE,
          recordId: company.id,
        })
        remindersSent += 1
      }
    }

    return { companiesScanned: companies.length, remindersSent }
  }
}
