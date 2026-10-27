import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { DEFAULT_LOCALE, SupportedLocale } from '../../common/i18n/locale'
import { MailService } from '../auth/services/mail.service'

export const NOTIFICATION_EMAIL_QUEUE = 'notification-email'

export interface NotificationEmailJob {
  to: string
  subject: string
  bodyText: string
  actionUrl?: string
  /** Special Corner SC-7 — drives the branded template's trust-footer line honestly: 'account' for a real SafeMeds user, 'external' for a reporter/distributor/etc. with no account at all. Defaults to 'account' for older enqueued jobs that predate this field. */
  recipientContext?: 'account' | 'external'
  /** todo-i18n.md Stage 5 — the recipient's own `preferredLocale` at the moment the job was enqueued (resolved once by `NotificationsService`, which is the only caller with a real `userId` to look it up by); defaults to English for jobs that predate this field or have no known locale (always true for `recipientContext: 'external'`). */
  locale?: SupportedLocale
}

/**
 * The actual "send it" half of `NotificationsService.create()` — queued
 * (not sent inline) so a slow/failed Resend call never blocks the
 * request that created the in-app notification row, and so BullMQ's
 * built-in retry/backoff covers transient failures without any custom
 * retry logic here. `MailService.send()` is itself best-effort/never-
 * throws (see its own doc comment), so a permanent failure here just
 * logs — the in-app row (the notification itself) is unaffected either
 * way, it was already committed before this job was even enqueued.
 */
@Processor(NOTIFICATION_EMAIL_QUEUE)
export class NotificationEmailProcessor extends WorkerHost {
  constructor(
    private readonly mailService: MailService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(job: Job<NotificationEmailJob>): Promise<void> {
    const { to, subject, bodyText, actionUrl, recipientContext, locale } = job.data
    await this.mailService.sendNotification(
      to,
      subject,
      bodyText,
      actionUrl,
      recipientContext ?? 'account',
      locale ?? DEFAULT_LOCALE,
    )
    this.logger.log({ to, subject }, 'Notification email processed')
  }
}
