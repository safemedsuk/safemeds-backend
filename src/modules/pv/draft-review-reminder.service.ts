import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { PV_CASE_RECORD_TYPE } from './pv-case.service'

/** Real-usage request, 22 Sep 2026 (item 13): "trigger an action to review within 24 hours, repeating every 24 hours until it moves to the next phase (or is rejected with a reason)." */
export const DRAFT_REVIEW_REMINDER_INTERVAL_HOURS = 24
const DRAFT_REVIEW_REMINDER_ACTION = 'pv_case_draft_review_reminder_sent'

export interface DraftReviewReminderResult {
  draftsScanned: number
  remindersSent: number
}

/**
 * VigiCloud real-usage request, 22 Sep 2026 (item 13) — a case that
 * lands in the shared Draft Review Queue (`requiresDraftReview: true`,
 * Stage 3.1's own `createFromSystemChannel()` path) needs a human to
 * act on it within 24 hours, repeating every 24 hours until it's
 * confirmed (`confirmDraft()`) or rejected (`rejectDraft()`) — either
 * one flips `requiresDraftReview` to `false` and this scan simply stops
 * finding it.
 *
 * Deliberately **not** a `Task`, unlike every other reminder in this
 * codebase (`ProductReviewReminderService` and friends): the queue is
 * visible to *any* of several roles holding `pv.triage_case` (per
 * `Case.draftClaimedBy`'s own schema doc comment — "Task.assignedRoleKey
 * is a single string and can't target 'any of several qualifying
 * roles'"), so a Task here would either under-notify (one hardcoded
 * role) or need a mechanism this codebase doesn't have. A notification
 * fan-out — to the specific claimant if one exists, or to every
 * `pv.triage_case`-holding user if not — reuses exactly the same
 * primitive `CaseFollowUpService.resolveHandler()`/
 * `resolveStaffRecipients()` already established for the same "named
 * handler, or a role-queue" shape.
 *
 * Due-ness is derived from the latest `pv_case_draft_review_reminder_sent`
 * audit entry for the case (falling back to the case's own `createdAt`
 * if none exists yet) — the same "derive due-ness from history, no
 * parallel tracking column" discipline every other reminder service in
 * this codebase already follows, just keyed off `AuditEntry` instead of
 * `Task` since there's no single Task this reminder could own.
 */
@Injectable()
export class DraftReviewReminderService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async scanAndRemind(): Promise<DraftReviewReminderResult> {
    const drafts = await this.rls.runWithSystemAccess((tx) =>
      tx.case.findMany({
        where: { requiresDraftReview: true },
        select: { id: true, companyId: true, referenceNumber: true, createdAt: true, draftClaimedBy: true },
      }),
    )

    let remindersSent = 0
    const cutoff = new Date(Date.now() - DRAFT_REVIEW_REMINDER_INTERVAL_HOURS * 60 * 60 * 1000)

    for (const draft of drafts) {
      const sent = await this.rls.runAsCompany(draft.companyId, async (tx) => {
        const mostRecentReminder = await tx.auditEntry.findFirst({
          where: {
            companyId: draft.companyId,
            action: DRAFT_REVIEW_REMINDER_ACTION,
            recordId: draft.id,
          },
          orderBy: { occurredAt: 'desc' },
        })
        const anchor = mostRecentReminder?.occurredAt ?? draft.createdAt
        if (anchor >= cutoff) return false

        const recipients = draft.draftClaimedBy
          ? await this.resolveClaimant(tx, draft.companyId, draft.draftClaimedBy)
          : await this.resolveTriageStaff(tx, draft.companyId)

        for (const recipient of recipients) {
          await this.notificationsService.create({
            companyId: draft.companyId,
            userId: recipient.id,
            category: 'draft_review',
            title: `Draft review due: case ${draft.referenceNumber}`,
            body: draft.draftClaimedBy
              ? 'You claimed this draft — it still needs to be confirmed or rejected.'
              : 'This draft has been waiting for review — confirm it as a real case, or reject it with a reason.',
            recordType: PV_CASE_RECORD_TYPE,
            recordId: draft.id,
          })
        }

        await this.auditService.log(tx, {
          companyId: draft.companyId,
          actorType: 'system',
          action: DRAFT_REVIEW_REMINDER_ACTION,
          recordType: PV_CASE_RECORD_TYPE,
          recordId: draft.id,
          newValue: { recipientCount: recipients.length },
        })
        return true
      })

      if (sent) remindersSent += 1
    }

    return { draftsScanned: drafts.length, remindersSent }
  }

  private async resolveClaimant(
    tx: Prisma.TransactionClient,
    companyId: string,
    claimedBy: string,
  ): Promise<{ id: string; email: string }[]> {
    const claimant = await tx.user.findFirst({
      where: { id: claimedBy, companyId, status: 'active' },
      select: { id: true, email: true },
    })
    return claimant ? [claimant] : await this.resolveTriageStaff(tx, companyId)
  }

  /** Every user in the company holding a role that grants `pv.triage_case` — mirrors `CaseFollowUpService.resolveStaffRecipients()` exactly. */
  private async resolveTriageStaff(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<{ id: string; email: string }[]> {
    const roles = await tx.role.findMany({
      where: { permissions: { some: { permission: { key: 'pv.triage_case' } } } },
      select: { key: true },
    })
    if (roles.length === 0) return []
    return tx.user.findMany({
      where: { companyId, roleKeys: { hasSome: roles.map((r) => r.key) } },
      select: { id: true, email: true },
    })
  }
}
