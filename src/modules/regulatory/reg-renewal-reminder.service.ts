import { Injectable } from '@nestjs/common'

import { RlsService } from '../../common/rls/rls.service'
import { NotificationsService } from '../notifications/notifications.service'
import { TasksService } from '../tasks/tasks.service'

export const REG_RENEWAL_REMINDER_RECORD_TYPE = 'reg_registration_renewal_reminder'

/**
 * testing-correction-explanation.md §3.2 — "trigger reminders every week
 * too 6 months before the expired date. Both in app and via the company
 * email." Deliberately **not** the usual "derive due-ness from Task
 * history, fire once" shape every other reminder in this repo uses
 * (`SdeaRenewalReminderService`, `ClinicalTrialAnnualReminderService`) —
 * this one is meant to keep firing every single week the condition
 * holds, so the weekly BullMQ schedule itself is the only cadence
 * control; a registration naturally stops qualifying the moment it's
 * actually renewed (`expiresOn` moves out past the 6-month window).
 * `escalateForRecord()` is still used for the Task half specifically
 * because it's already idempotent (one open task stays open, never
 * duplicated) — only the notification + email fire fresh on every run.
 */
export interface RegRenewalReminderResult {
  registrationsScanned: number
  remindersSent: number
}

const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000

@Injectable()
export class RegRenewalReminderService {
  constructor(
    private readonly rls: RlsService,
    private readonly tasksService: TasksService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async scanAndRemind(): Promise<RegRenewalReminderResult> {
    const now = new Date()
    const cutoff = new Date(now.getTime() + SIX_MONTHS_MS)

    const dueRegistrations = await this.rls.runWithSystemAccess((tx) =>
      tx.productRegistration.findMany({
        where: { status: 'active', expiresOn: { gt: now, lte: cutoff } },
        include: { product: { select: { brandName: true } }, company: true },
      }),
    )

    for (const registration of dueRegistrations) {
      const title = `Renewal due — ${registration.product.brandName} (${registration.registrationNumber}) expires ${registration.expiresOn.toISOString().slice(0, 10)}`

      await this.tasksService.escalateForRecord(
        registration.companyId,
        REG_RENEWAL_REMINDER_RECORD_TYPE,
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
          body: `${title}. Start the renewal from Master Data → Registrations before it lapses.`,
          type: 'renewal_due',
          params: {
            brandName: registration.product.brandName,
            registrationNumber: registration.registrationNumber,
            expiresOn: registration.expiresOn.toISOString().slice(0, 10),
          },
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
          `This is a weekly reminder that ${registration.product.brandName}'s registration (${registration.registrationNumber}) expires on ${registration.expiresOn.toISOString().slice(0, 10)}. Please start the renewal in SafeMeds before it lapses.`,
        )
      }
    }

    return { registrationsScanned: dueRegistrations.length, remindersSent: dueRegistrations.length }
  }
}
