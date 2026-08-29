import { Injectable } from '@nestjs/common'

import { RlsService } from '../../common/rls/rls.service'
import { TasksService } from '../tasks/tasks.service'
import { TRAINING_RECORD_RECORD_TYPE } from './training-record.service'

const EXPIRY_WARNING_DAYS = 30

export interface TrainingReminderResult {
  recordsScanned: number
  remindersCreated: number
}

/**
 * VigiCloud Stage 16.6 — "due-date reminder job (same scheduled-task
 * pattern as Stage 2's quarterly reminder)." A training record within
 * 30 days of its own `expiryDate` (or already past it) gets a reminder
 * `Task` assigned to the staff member themselves (`assignedUserId`, not
 * a role — this is personal to them, unlike every other Stage 16
 * reminder), throttled per-record the same way `SdeaRenewalReminderService`
 * throttles per-SDEA.
 */
@Injectable()
export class TrainingReminderService {
  constructor(
    private readonly rls: RlsService,
    private readonly tasksService: TasksService,
  ) {}

  async scanAndRemind(): Promise<TrainingReminderResult> {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() + EXPIRY_WARNING_DAYS)

    const dueRecords = await this.rls.runWithSystemAccess((tx) =>
      tx.trainingRecord.findMany({
        where: { expiryDate: { not: null, lte: cutoff } },
        select: { id: true, companyId: true, userId: true, title: true, expiryDate: true },
      }),
    )

    let remindersCreated = 0

    for (const record of dueRecords) {
      const alreadyReminded = await this.rls.runAsCompany(record.companyId, (tx) =>
        tx.task.findFirst({
          where: {
            companyId: record.companyId,
            recordType: TRAINING_RECORD_RECORD_TYPE,
            recordId: record.id,
          },
        }),
      )
      if (alreadyReminded) continue

      await this.tasksService.createForWorkflowState(
        {
          companyId: record.companyId,
          recordType: TRAINING_RECORD_RECORD_TYPE,
          recordId: record.id,
          title: `Training renewal due — "${record.title}" expires ${record.expiryDate?.toISOString().slice(0, 10)}`,
          assignedUserId: record.userId,
        },
        {},
      )
      remindersCreated += 1
    }

    return { recordsScanned: dueRecords.length, remindersCreated }
  }
}
