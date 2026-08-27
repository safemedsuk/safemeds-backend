import { Injectable } from '@nestjs/common'

import { RlsService } from '../../common/rls/rls.service'
import { TasksService } from '../tasks/tasks.service'

export const SDEA_RENEWAL_RECORD_TYPE = 'sdea_renewal'

const EXPIRY_WARNING_DAYS = 60

export interface SdeaRenewalReminderResult {
  sdeasScanned: number
  remindersCreated: number
}

/**
 * VigiCloud Stage 16.5 — "renewal reminders (2-3 years per Final doc)."
 * No new tracking table: same "derive due-ness from `Task` history, no
 * parallel tracking column" pattern as every other reminder in this
 * repo. An active SDEA within `EXPIRY_WARNING_DAYS` of its own
 * `expiryDate` (or already past it) is due for a reminder, throttled by
 * "was a reminder already created for this specific SDEA row."
 */
@Injectable()
export class SdeaRenewalReminderService {
  constructor(
    private readonly rls: RlsService,
    private readonly tasksService: TasksService,
  ) {}

  async scanAndRemind(): Promise<SdeaRenewalReminderResult> {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() + EXPIRY_WARNING_DAYS)

    const activeSdeas = await this.rls.runWithSystemAccess((tx) =>
      tx.sdea.findMany({
        where: { status: 'active', expiryDate: { not: null, lte: cutoff } },
        select: { id: true, companyId: true, distributorId: true, title: true, expiryDate: true },
      }),
    )

    let remindersCreated = 0

    for (const sdea of activeSdeas) {
      const alreadyReminded = await this.rls.runAsCompany(sdea.companyId, (tx) =>
        tx.task.findFirst({
          where: {
            companyId: sdea.companyId,
            recordType: SDEA_RENEWAL_RECORD_TYPE,
            recordId: sdea.id,
          },
        }),
      )
      if (alreadyReminded) continue

      await this.tasksService.createForWorkflowState(
        {
          companyId: sdea.companyId,
          recordType: SDEA_RENEWAL_RECORD_TYPE,
          recordId: sdea.id,
          title: `SDEA renewal due — "${sdea.title}" expires ${sdea.expiryDate?.toISOString().slice(0, 10)}`,
          assignedRoleKey: 'QUALITY_MANAGER',
        },
        {},
      )
      remindersCreated += 1
    }

    return { sdeasScanned: activeSdeas.length, remindersCreated }
  }
}
