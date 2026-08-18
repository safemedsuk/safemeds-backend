import { Injectable } from '@nestjs/common'

import { RlsService } from '../../common/rls/rls.service'
import { TasksService } from '../tasks/tasks.service'

export const PRODUCT_REVIEW_RECORD_TYPE = 'product_list_review'

/**
 * A real product list only stays trustworthy as PV/regulatory ground
 * truth if it's actually kept current — per the user's own note captured
 * in `todo-vigicloud.md`'s Stage 2 planning: *"Onboard of a new client
 * should provide product list per country, and they should give us an
 * updated list quarterly. We should trigger a reminder every quarter."*
 * ~91 days (one quarter) between reminders, not a calendar-quarter
 * boundary — simpler to reason about and avoids a cluster of every
 * tenant's reminder firing on the same calendar day.
 */
const QUARTERLY_REVIEW_INTERVAL_DAYS = 91

export interface ProductReviewReminderResult {
  companiesScanned: number
  remindersCreated: number
}

/**
 * VigiCloud Stage 2 — the quarterly product-list-review reminder. No new
 * tracking table: the `Task` history itself is the record of "when was
 * this company last reminded" (the same "derive from existing state,
 * don't add a parallel flag" instinct `WorkflowService` follows for
 * `WorkflowInstance.currentState`) — a company is due for a new reminder
 * if it has never had one, or its most recent one (of either status) is
 * older than one quarter. Creating a *second* open reminder while one is
 * still open is avoided the same way: the "most recent" check covers
 * that too, since an open task's `createdAt` is necessarily recent.
 */
@Injectable()
export class ProductReviewReminderService {
  constructor(
    private readonly rls: RlsService,
    private readonly tasksService: TasksService,
  ) {}

  async scanAndRemind(): Promise<ProductReviewReminderResult> {
    const companies = await this.rls.runWithSystemAccess((tx) =>
      tx.company.findMany({ where: { status: 'active' }, select: { id: true } }),
    )

    let remindersCreated = 0
    const cutoff = new Date(Date.now() - QUARTERLY_REVIEW_INTERVAL_DAYS * 24 * 60 * 60 * 1000)

    for (const company of companies) {
      const isDue = await this.rls.runAsCompany(company.id, async (tx) => {
        const mostRecent = await tx.task.findFirst({
          where: { companyId: company.id, recordType: PRODUCT_REVIEW_RECORD_TYPE },
          orderBy: { createdAt: 'desc' },
        })
        return !mostRecent || mostRecent.createdAt < cutoff
      })

      if (!isDue) continue

      // `createForWorkflowState` audits its own `task_created` entry
      // (title, recordType, recordId, assignedRoleKey) — no separate
      // audit write needed here.
      await this.tasksService.createForWorkflowState(
        {
          companyId: company.id,
          recordType: PRODUCT_REVIEW_RECORD_TYPE,
          recordId: company.id,
          title:
            'Quarterly product list review — confirm your product catalog is current, per country',
          assignedRoleKey: 'SYSTEM_ADMINISTRATOR',
        },
        {},
      )
      remindersCreated += 1
    }

    return { companiesScanned: companies.length, remindersCreated }
  }
}
