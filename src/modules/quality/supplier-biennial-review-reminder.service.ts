import { Injectable } from '@nestjs/common'

import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { BIENNIAL_REVIEW_MONTHS, SUPPLIER_RECORD_TYPE } from './supplier-qualification.service'

/** Remind this many days before the biennial review is due (and keep reminding once overdue). */
export const BIENNIAL_REVIEW_LEAD_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000
/** A user who can approve suppliers is the person who runs the biennial review. */
export const SUPPLIER_APPROVAL_PERMISSION = 'quality.approve_suppliers'

/**
 * QualCloud Phase 1 Pass B (item D3) — the daily scan that reminds the
 * quality team that an approved supplier's two-year performance review is
 * due. Reminders go out in-app and by email to every active user holding
 * `quality.approve_suppliers`.
 *
 * ANCHOR (stated decision): the review clock runs from the most recent of
 * (a) the latest performance review recorded by `monitor()`, (b) the
 * supplier's last qualification (`lastQualifiedAt`, set on approval), and
 * (c) the supplier's creation date. The first reminder therefore falls two
 * years after approval for a supplier never reviewed, and two years after
 * each review thereafter.
 *
 * DEDUPE: the stored `reviewReminderSentForDueAt` records the due date a
 * reminder was already sent for. The scan sends at most one reminder per due
 * date, so a daily re-run never double-sends. The due-date value is written
 * before notifications go out (at-most-once, the same ordering
 * `DeviationInvestigationReminderService` uses).
 */
@Injectable()
export class SupplierBiennialReviewReminderService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Pure: the anchor the next review is counted from. */
  static anchorFor(
    supplier: { createdAt: Date; lastQualifiedAt: Date | null },
    latestReviewAt: Date | null,
  ): Date {
    return latestReviewAt ?? supplier.lastQualifiedAt ?? supplier.createdAt
  }

  /** Pure: the next biennial review due date for an anchor. */
  static dueAtFor(anchor: Date): Date {
    const due = new Date(anchor)
    due.setUTCMonth(due.getUTCMonth() + BIENNIAL_REVIEW_MONTHS)
    return due
  }

  /** Pure: whether a reminder should fire now for this due date, given the due date already reminded for. */
  static shouldRemind(dueAt: Date, now: Date, sentForDueAt: Date | null): boolean {
    if (sentForDueAt && sentForDueAt.getTime() === dueAt.getTime()) return false
    return dueAt.getTime() - now.getTime() <= BIENNIAL_REVIEW_LEAD_DAYS * DAY_MS
  }

  async scan(now = new Date()): Promise<{ scanned: number; remindersSent: number }> {
    const suppliers = await this.rls.runWithSystemAccess((tx) =>
      tx.supplier.findMany({
        where: { isActive: true, approvalStatus: 'approved' },
        select: {
          id: true,
          companyId: true,
          name: true,
          createdAt: true,
          lastQualifiedAt: true,
          reviewReminderSentForDueAt: true,
          performanceReviews: {
            orderBy: { reviewedAt: 'desc' },
            take: 1,
            select: { reviewedAt: true },
          },
        },
      }),
    )

    let remindersSent = 0
    for (const supplier of suppliers) {
      const latestReviewAt = supplier.performanceReviews[0]?.reviewedAt ?? null
      const dueAt = SupplierBiennialReviewReminderService.dueAtFor(
        SupplierBiennialReviewReminderService.anchorFor(supplier, latestReviewAt),
      )
      if (
        !SupplierBiennialReviewReminderService.shouldRemind(
          dueAt,
          now,
          supplier.reviewReminderSentForDueAt,
        )
      ) {
        continue
      }

      const recipientIds = await this.resolveRecipients(supplier.companyId)
      const overdue = dueAt.getTime() < now.getTime()
      const dueDate = dueAt.toISOString().slice(0, 10)

      await this.rls.runAsCompany(supplier.companyId, async (tx) => {
        await tx.supplier.update({
          where: { id: supplier.id },
          data: { reviewReminderSentForDueAt: dueAt },
        })
        await this.auditService.log(tx, {
          companyId: supplier.companyId,
          actorType: 'system',
          action: 'supplier_biennial_review_reminder_sent',
          recordType: SUPPLIER_RECORD_TYPE,
          recordId: supplier.id,
          newValue: { dueAt, overdue, recipientUserIds: recipientIds },
        })
      })

      const title = overdue
        ? `Supplier review overdue: ${supplier.name}`
        : `Supplier review due: ${supplier.name}`
      const body = overdue
        ? `The two-year performance review for ${supplier.name} was due on ${dueDate} and has not been recorded.`
        : `The two-year performance review for ${supplier.name} is due on ${dueDate}. Upload the review checklist and record the review.`

      for (const userId of recipientIds) {
        const user = await this.rls.runWithSystemAccess((tx) =>
          tx.user.findUnique({ where: { id: userId }, select: { email: true } }),
        )
        await this.notificationsService.create({
          companyId: supplier.companyId,
          userId,
          category: overdue ? 'deadline_breached' : 'deadline_approaching',
          title,
          body,
          recordType: SUPPLIER_RECORD_TYPE,
          recordId: supplier.id,
          email: user ? { to: user.email } : undefined,
        })
      }
      remindersSent += 1
    }

    return { scanned: suppliers.length, remindersSent }
  }

  private async resolveRecipients(companyId: string): Promise<string[]> {
    return this.rls.runWithSystemAccess(async (tx) => {
      const roles = await tx.role.findMany({
        where: { permissions: { some: { permission: { key: SUPPLIER_APPROVAL_PERMISSION } } } },
        select: { key: true },
      })
      if (roles.length === 0) return []
      const users = await tx.user.findMany({
        where: { companyId, status: 'active', roleKeys: { hasSome: roles.map((r) => r.key) } },
        select: { id: true },
      })
      return users.map((u) => u.id)
    })
  }
}
