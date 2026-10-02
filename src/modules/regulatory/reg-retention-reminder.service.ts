import { Injectable } from '@nestjs/common'

import { RlsService } from '../../common/rls/rls.service'
import { NotificationsService } from '../notifications/notifications.service'
import { TasksService } from '../tasks/tasks.service'

export const REG_RETENTION_REMINDER_RECORD_TYPE = 'reg_retention_reminder'

/**
 * testing-correction-explanation.md §3.4 — "a warning that appears once
 * every week for the 60 days we have before december 1st until they pay
 * and do the retention... in app... and emails." The retention year
 * always ends 31 December, so the window is 1 October through 31
 * December — same "the weekly BullMQ schedule is the cadence control,
 * not Task-history de-duplication" shape `RegRenewalReminderService`
 * already established; this one self-terminates the moment a
 * `RegRetention` row exists for the current year.
 */
export interface RegRetentionReminderResult {
  registrationsScanned: number
  remindersSent: number
}

/** Exported for `DashboardService`'s own "retentions due, none logged" open-item — reused rather than re-derived, so the dashboard and the actual reminder job never disagree on what "due" means. */
export function isWithinRetentionWindow(now: Date): boolean {
  // 1 October through 31 December, inclusive — month is 0-indexed (9 = October, 11 = December).
  return now.getUTCMonth() >= 9
}

@Injectable()
export class RegRetentionReminderService {
  constructor(
    private readonly rls: RlsService,
    private readonly tasksService: TasksService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async scanAndRemind(): Promise<RegRetentionReminderResult> {
    const now = new Date()
    if (!isWithinRetentionWindow(now)) {
      return { registrationsScanned: 0, remindersSent: 0 }
    }
    const year = now.getUTCFullYear()

    const activeRegistrations = await this.rls.runWithSystemAccess((tx) =>
      tx.productRegistration.findMany({
        where: { status: 'active', expiresOn: { gt: now } },
        include: {
          product: { select: { brandName: true } },
          company: true,
          regRetentions: { where: { year }, select: { id: true } },
        },
      }),
    )
    const dueRegistrations = activeRegistrations.filter((r) => r.regRetentions.length === 0)

    for (const registration of dueRegistrations) {
      const title = `${year} retention due — ${registration.product.brandName} (${registration.registrationNumber})`

      await this.tasksService.escalateForRecord(
        registration.companyId,
        REG_RETENTION_REMINDER_RECORD_TYPE,
        registration.id,
        'due_soon',
        title,
        {},
      )

      const recipients = await this.rls.runAsCompany(registration.companyId, (tx) =>
        tx.user.findMany({
          where: {
            companyId: registration.companyId,
            roleKeys: { has: 'REGULATORY_AFFAIRS_OFFICER' },
            status: 'active',
          },
          select: { id: true },
        }),
      )
      for (const recipient of recipients) {
        await this.notificationsService.create({
          companyId: registration.companyId,
          userId: recipient.id,
          category: 'deadline_approaching',
          title,
          body: `${title}. Log the invoice and proof of payment before 31 December ${year} to keep this registration in good standing.`,
          recordType: 'product_registration',
          recordId: registration.id,
        })
      }

      // Best-effort — silently skipped (never thrown) if the company has
      // no regulatoryContactEmail on file yet (decision #4).
      if (registration.company.regulatoryContactEmail) {
        await this.notificationsService.sendExternalEmail(
          registration.company.regulatoryContactEmail,
          title,
          `This is a weekly reminder that ${registration.product.brandName}'s ${year} retention (registration ${registration.registrationNumber}) has not yet been logged. Please log the invoice and proof of payment in SafeMeds before 31 December ${year}.`,
        )
      }
    }

    return { registrationsScanned: activeRegistrations.length, remindersSent: dueRegistrations.length }
  }
}
