import { Injectable } from '@nestjs/common'

import { RlsService } from '../../common/rls/rls.service'
import { TasksService } from '../tasks/tasks.service'

export const PHONE_REACHABILITY_REMINDER_RECORD_TYPE = 'phone_reachability_reminder'

/** No confirmed cadence source names a number — "periodic" per the todo doc's own wording — a monthly-ish window matches Stage 19's literature-monitoring cadence and Stage 16.2's own 180-day evidence-currency window comfortably. */
const REACHABILITY_TEST_WINDOW_DAYS = 30

export interface PhoneReachabilityReminderResult {
  companiesScanned: number
  remindersCreated: number
}

/**
 * VigiCloud Stage 21 — "Periodic test-call reminders (reuses Stage
 * 15.2's ContactTest mechanism specifically for the phone channel)."
 * This job doesn't run the test itself — `ContactTestService` (Stage
 * 15.2) already does that, real reuse, not rebuilt here — it only makes
 * sure someone is nudged to actually go initiate one periodically for
 * the QPPV/hotline phone channel, same "derive due-ness from `Task`
 * history plus the real underlying record" shape as
 * `LiteratureMonitoringReminderService`.
 */
@Injectable()
export class PhoneReachabilityReminderService {
  constructor(
    private readonly rls: RlsService,
    private readonly tasksService: TasksService,
  ) {}

  async scanAndRemind(): Promise<PhoneReachabilityReminderResult> {
    const companies = await this.rls.runWithSystemAccess((tx) =>
      tx.company.findMany({ where: { status: 'active' }, select: { id: true } }),
    )

    let remindersCreated = 0
    const cutoff = new Date(Date.now() - REACHABILITY_TEST_WINDOW_DAYS * 24 * 60 * 60 * 1000)

    for (const company of companies) {
      const isDue = await this.rls.runAsCompany(company.id, async (tx) => {
        const mostRecentReminder = await tx.task.findFirst({
          where: {
            companyId: company.id,
            recordType: PHONE_REACHABILITY_REMINDER_RECORD_TYPE,
            recordId: company.id,
          },
          orderBy: { createdAt: 'desc' },
        })
        if (mostRecentReminder && mostRecentReminder.createdAt >= cutoff) return false

        const mostRecentTest = await tx.contactTest.findFirst({
          where: { companyId: company.id, channel: 'phone' },
          orderBy: { createdAt: 'desc' },
        })
        return !mostRecentTest || mostRecentTest.createdAt < cutoff
      })

      if (!isDue) continue

      await this.tasksService.createForWorkflowState(
        {
          companyId: company.id,
          recordType: PHONE_REACHABILITY_REMINDER_RECORD_TYPE,
          recordId: company.id,
          title:
            'QPPV phone/hotline reachability test due — run a Contact Test on the phone channel',
          assignedRoleKey: 'QPPV',
        },
        {},
      )
      remindersCreated += 1
    }

    return { companiesScanned: companies.length, remindersCreated }
  }
}
