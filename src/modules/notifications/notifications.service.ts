import { InjectQueue } from '@nestjs/bullmq'
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Notification, NotificationCategory, NotificationPreference } from '@prisma/client'
import { Queue } from 'bullmq'

import { resolveLocale } from '../../common/i18n/locale'
import {
  NotificationParams,
  NotificationType,
  resolveNotificationContent,
} from '../../common/i18n/notification-content'
import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { PrismaService } from '../../prisma/prisma.service'
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto'
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto'
import { NOTIFICATION_EMAIL_QUEUE, NotificationEmailJob } from './notification-email.processor'

export interface CreateNotificationInput {
  companyId: string
  userId: string
  category: NotificationCategory
  /** English fallback — always used verbatim if `type` is omitted, or (defensively) if `type` is ever a value `resolveNotificationContent()` doesn't recognize. */
  title: string
  body?: string
  recordType?: string
  recordId?: string
  /**
   * todo-i18n.md decision 6 — when given alongside `params`, the real
   * title/body written to this row (and reused for the matching
   * notification email) are resolved in the *recipient's own*
   * `preferredLocale` via `resolveNotificationContent()`, overriding
   * `title`/`body` above entirely. Every call site is expected to pass
   * this eventually; `title`/`body` stay required so a call site that
   * hasn't been converted yet (or a genuinely new one) still produces
   * a correct, if English-only, notification.
   */
  type?: NotificationType
  params?: NotificationParams
  /** Only sent if the recipient's preference for this category allows it — see `emailEnabledFor()`. */
  email?: { to: string; actionUrl?: string }
}

const CATEGORY_TO_PREFERENCE_FIELD: Record<
  NotificationCategory,
  keyof NotificationPreference | null
> = {
  task_assigned: 'emailTaskAssigned',
  deadline_approaching: 'emailDeadline',
  deadline_breached: 'emailDeadline',
  workflow_update: 'emailWorkflowUpdate',
  case_follow_up: 'emailCaseFollowUp',
  // Real-usage request, 22 Sep 2026 (item 13) — in-app only; the Draft Review Queue screen itself is the real due-list, matching this codebase's own in-app-only precedent for screen-visible reminders.
  draft_review: null,
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Notifications are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * Phase 9 — in-app rows always get written (that's the inbox itself);
 * whether an email *also* goes out is gated per-user, per-category by
 * `NotificationPreference` (defaults: task/deadline on, workflow-update
 * off — matches the spec's "minimal: email on/off per category").
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly rls: RlsService,
    // Preferences are user-scoped, not RLS-protected (see the migration's
    // comment on why) — read directly via PrismaService rather than
    // routing through a company-scoped transaction for a single-row,
    // exact-id lookup.
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFICATION_EMAIL_QUEUE) private readonly emailQueue: Queue<NotificationEmailJob>,
  ) {}

  async create(input: CreateNotificationInput): Promise<Notification> {
    // Resolved once, up front, since both the in-app row and its
    // matching email (if any) need the same recipient-locale-aware
    // title/body — fetching the recipient's own `preferredLocale`
    // here (rather than only when an email is actually queued) is
    // what lets the in-app notification itself be correct even for a
    // user who has email notifications for this category turned off.
    const recipient = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { preferredLocale: true },
    })
    const locale = resolveLocale(recipient?.preferredLocale)
    const resolved =
      input.type && input.params
        ? resolveNotificationContent(input.type, locale, input.params)
        : null
    const title = resolved?.title ?? input.title
    const body = resolved?.body ?? input.body

    const created = await this.rls.runAsCompany(input.companyId, (tx) =>
      tx.notification.create({
        data: {
          id: newId(),
          companyId: input.companyId,
          userId: input.userId,
          category: input.category,
          title,
          body,
          recordType: input.recordType,
          recordId: input.recordId,
        },
      }),
    )

    if (input.email && (await this.emailEnabledFor(input.userId, input.category))) {
      await this.emailQueue.add(
        'send',
        {
          to: input.email.to,
          subject: title,
          bodyText: body ?? title,
          actionUrl: input.email.actionUrl,
          recipientContext: 'account',
          locale,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      )
    }

    return created
  }

  /**
   * VigiCloud Stage 11 — the case-follow-up email attempt goes to the
   * *reporter*, an external human with no `User` row and therefore no
   * `Notification`/`NotificationPreference` to gate against. Real reuse
   * of the same Phase 9 email infrastructure (`NOTIFICATION_EMAIL_QUEUE`/
   * `NotificationEmailProcessor`/`MailService.sendNotification`) rather
   * than a parallel mailer — just skipping the in-app-row + preference-
   * check half of `create()`, which only make sense for an internal user.
   */
  async sendExternalEmail(
    to: string,
    subject: string,
    bodyText: string,
    actionUrl?: string,
  ): Promise<void> {
    await this.emailQueue.add(
      'send',
      { to, subject, bodyText, actionUrl, recipientContext: 'external' },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    )
  }

  private async emailEnabledFor(userId: string, category: NotificationCategory): Promise<boolean> {
    const field = CATEGORY_TO_PREFERENCE_FIELD[category]
    if (!field) return false

    const pref = await this.prisma.notificationPreference.findUnique({ where: { userId } })
    // No row yet = defaults, which per the schema are "on" for task/deadline, "off" for workflow-update.
    if (!pref) return field !== 'emailWorkflowUpdate'
    return Boolean(pref[field])
  }

  async list(
    actor: AuthenticatedUser,
    query: ListNotificationsQueryDto,
  ): Promise<{ rows: Notification[]; nextCursor: string | null }> {
    const companyId = requireCompany(actor)
    const limit = 25

    return this.rls.runAsCompany(companyId, async (tx) => {
      const rows = await tx.notification.findMany({
        where: {
          companyId,
          userId: actor.sub,
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
          ...(query.unreadOnly === 'true' ? { readAt: null } : {}),
        },
        orderBy: { id: 'desc' },
        take: limit,
      })
      return { rows, nextCursor: rows.length === limit ? rows[rows.length - 1].id : null }
    })
  }

  async unreadCount(actor: AuthenticatedUser): Promise<number> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.notification.count({ where: { companyId, userId: actor.sub, readAt: null } }),
    )
  }

  async markRead(actor: AuthenticatedUser, id: string): Promise<Notification> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.notification.findFirst({
        where: { id, companyId, userId: actor.sub },
      })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Notification not found' })
      if (existing.readAt) return existing
      return tx.notification.update({ where: { id }, data: { readAt: new Date() } })
    })
  }

  async getPreference(actor: AuthenticatedUser): Promise<NotificationPreference> {
    const existing = await this.prisma.notificationPreference.findUnique({
      where: { userId: actor.sub },
    })
    if (existing) return existing
    // Defaults, materialised on first read so an UPDATE later has a row to target.
    return this.prisma.notificationPreference.create({ data: { userId: actor.sub } })
  }

  async updatePreference(
    actor: AuthenticatedUser,
    dto: UpdateNotificationPreferenceDto,
  ): Promise<NotificationPreference> {
    await this.getPreference(actor) // ensure the row exists
    return this.prisma.notificationPreference.update({
      where: { userId: actor.sub },
      data: {
        ...(dto.emailTaskAssigned !== undefined
          ? { emailTaskAssigned: dto.emailTaskAssigned }
          : {}),
        ...(dto.emailDeadline !== undefined ? { emailDeadline: dto.emailDeadline } : {}),
        ...(dto.emailWorkflowUpdate !== undefined
          ? { emailWorkflowUpdate: dto.emailWorkflowUpdate }
          : {}),
      },
    })
  }
}
