import { Injectable } from '@nestjs/common'

import { RlsService } from '../../common/rls/rls.service'
import { TasksService } from '../tasks/tasks.service'

export const CLINICAL_TRIAL_ANNUAL_RENEWAL_RECORD_TYPE = 'clinical_trial_annual_renewal'

/**
 * VigiCloud Stage 14 — "Annual renewal requirement: an AE line listing
 * (Stage 18) plus the DSUR (Stage 18's periodic-report family) due
 * annually per trial — a scheduled reminder task, same pattern as
 * Stage 2's quarterly product-list reminder." This is that reminder,
 * per *trial* rather than per company (a company can run several
 * trials, each on its own anniversary) — same "derive due-ness from
 * `Task` history, no parallel tracking column" instinct
 * `ProductReviewReminderService` already established. The actual line
 * listing/DSUR *generation* is genuinely Stage 18 scope, not built
 * here — this only ever creates the reminder `Task`.
 */
const ANNUAL_RENEWAL_INTERVAL_DAYS = 365

export interface ClinicalTrialAnnualReminderResult {
  trialsScanned: number
  remindersCreated: number
}

@Injectable()
export class ClinicalTrialAnnualReminderService {
  constructor(
    private readonly rls: RlsService,
    private readonly tasksService: TasksService,
  ) {}

  async scanAndRemind(): Promise<ClinicalTrialAnnualReminderResult> {
    const trials = await this.rls.runWithSystemAccess((tx) =>
      tx.clinicalTrial.findMany({
        where: { status: 'active' },
        select: { id: true, companyId: true, trialReference: true, startDate: true },
      }),
    )

    let remindersCreated = 0
    const cutoff = new Date(Date.now() - ANNUAL_RENEWAL_INTERVAL_DAYS * 24 * 60 * 60 * 1000)

    for (const trial of trials) {
      const isDue = await this.rls.runAsCompany(trial.companyId, async (tx) => {
        const mostRecent = await tx.task.findFirst({
          where: {
            companyId: trial.companyId,
            recordType: CLINICAL_TRIAL_ANNUAL_RENEWAL_RECORD_TYPE,
            recordId: trial.id,
          },
          orderBy: { createdAt: 'desc' },
        })
        const anchor = mostRecent?.createdAt ?? trial.startDate
        return anchor < cutoff
      })

      if (!isDue) continue

      await this.tasksService.createForWorkflowState(
        {
          companyId: trial.companyId,
          recordType: CLINICAL_TRIAL_ANNUAL_RENEWAL_RECORD_TYPE,
          recordId: trial.id,
          title: `Annual renewal due — trial ${trial.trialReference}: submit the AE line listing and DSUR`,
          assignedRoleKey: 'QPPV',
        },
        {},
      )
      remindersCreated += 1
    }

    return { trialsScanned: trials.length, remindersCreated }
  }
}
