import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { render } from '@react-email/render'
import type { ReactElement } from 'react'
import { Resend } from 'resend'

import { EnvConfig } from '../../../config/env.validation'
import { ApprovalEmail } from '../emails/approval.email'
import { InvitationEmail } from '../emails/invitation.email'
import { NotificationEmail } from '../emails/notification.email'
import { PasswordChangedEmail } from '../emails/password-changed.email'
import { PasswordResetEmail } from '../emails/password-reset.email'
import { RejectionEmail } from '../emails/rejection.email'
import { VerificationCodeEmail } from '../emails/verification-code.email'

/**
 * testing-todo Stage 11.2 — `.env.test`'s `RESEND_API_KEY` is a
 * deliberate, recognizable non-real placeholder (see that file); a real
 * `.env` (used by `pnpm start:dev`) has always carried a genuine key
 * since Phase 1 — real email sends work there, confirmed. Detected once
 * at startup so `dispatch()`'s own best-effort failure log can say so
 * plainly, instead of an ordinary-looking ERROR line that reads
 * identically to a genuine production delivery failure.
 */
const PLACEHOLDER_KEY_PREFIX = 're_dev_placeholder'

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)
  private readonly resend: Resend
  private readonly fromAddress: string
  private readonly isPlaceholderKey: boolean

  constructor(configService: ConfigService<EnvConfig, true>) {
    const apiKey = configService.get('RESEND_API_KEY', { infer: true })
    this.resend = new Resend(apiKey)
    const fromName = configService.get('MAIL_FROM_NAME', { infer: true })
    const fromAddress = configService.get('MAIL_FROM_ADDRESS', { infer: true })
    this.fromAddress = `${fromName} <${fromAddress}>`

    this.isPlaceholderKey = apiKey.startsWith(PLACEHOLDER_KEY_PREFIX)
    if (this.isPlaceholderKey) {
      this.logger.warn(
        "RESEND_API_KEY is the dev/test placeholder value — every outbound email will fail to send. This is expected in the e2e test environment; if you're seeing this from a real `pnpm start:dev` run, check .env.",
      )
    }
  }

  async sendVerificationCode(to: string, code: string, expiresInMinutes: number): Promise<void> {
    await this.send(
      to,
      'Verify your SafeMeds email address',
      VerificationCodeEmail({ code, expiresInMinutes, recipientEmail: to }),
    )
  }

  async sendRegistrationApproved(to: string, companyName: string, loginUrl: string): Promise<void> {
    await this.send(
      to,
      'Your SafeMeds registration has been approved',
      ApprovalEmail({ companyName, loginUrl, recipientEmail: to }),
    )
  }

  async sendRegistrationRejected(
    to: string,
    companyName: string,
    reason: string,
    registerUrl: string,
  ): Promise<void> {
    await this.send(
      to,
      'Your SafeMeds registration was not approved',
      RejectionEmail({ companyName, reason, registerUrl, recipientEmail: to }),
    )
  }

  async sendPasswordResetLink(
    to: string,
    resetUrl: string,
    expiresInMinutes: number,
  ): Promise<void> {
    await this.send(
      to,
      'Reset your SafeMeds password',
      PasswordResetEmail({ resetUrl, expiresInMinutes, recipientEmail: to }),
    )
  }

  async sendPasswordChangedConfirmation(to: string, occurredAt: Date): Promise<void> {
    await this.send(
      to,
      'Your SafeMeds password was changed',
      PasswordChangedEmail({
        recipientEmail: to,
        occurredAt:
          occurredAt.toLocaleString('en-GB', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'UTC',
          }) + ' UTC',
      }),
    )
  }

  async sendInvitation(
    to: string,
    companyName: string,
    inviterName: string,
    roleLabels: string[],
    acceptUrl: string,
    expiresInDays: number,
  ): Promise<void> {
    await this.send(
      to,
      `You've been invited to join ${companyName} on SafeMeds`,
      InvitationEmail({
        companyName,
        inviterName,
        roleLabels,
        acceptUrl,
        expiresInDays,
        recipientEmail: to,
      }),
    )
  }

  /**
   * Special Corner SC-7 — every task/deadline notification, plus every
   * external notice routed through `NotificationsService.sendExternalEmail()`
   * (contact-testing pings, case-follow-up reporter outreach, safety-
   * alert/DHCP-letter recipient notices), now renders through the same
   * branded `EmailLayout`/`LogoMark` system the 6 auth-flow templates
   * already use, via the shared `NotificationEmail` component — closing
   * the gap where these previously bypassed it entirely for a raw,
   * hand-built HTML string with no logo. `recipientContext` keeps the
   * footer's trust line honest: 'account' names a real SafeMeds user,
   * 'external' covers a reporter/distributor who has no account at
   * all — `NotificationEmailProcessor` always passes the real value
   * through from `NotificationsService`'s own two callers
   * (`create()`/`sendExternalEmail()`); the `'account'` default here
   * only matters for the (currently nonexistent) case of calling this
   * method directly, outside that queue.
   */
  async sendNotification(
    to: string,
    subject: string,
    bodyText: string,
    actionUrl?: string,
    recipientContext: 'account' | 'external' = 'account',
  ): Promise<void> {
    await this.send(
      to,
      subject,
      NotificationEmail({
        heading: subject,
        bodyText,
        actionUrl,
        recipientEmail: to,
        recipientContext,
      }),
    )
  }

  /**
   * VigiCloud Stage 3.3 — sent when an inbound drug-safety email is
   * missing one or more of the minimum-criteria fields
   * (patient/product/event) `EmailExtractionService` needs to create a
   * draft case. Always an external reporter with no SafeMeds account.
   */
  async sendCaseIntakeFollowUp(
    to: string,
    companyName: string,
    missingFields: string[],
    originalSubject: string,
  ): Promise<void> {
    await this.send(
      to,
      `Additional information needed — ${companyName} drug safety report`,
      NotificationEmail({
        heading: 'A few more details needed',
        eyebrow: 'Drug safety report',
        bodyText: `Thank you for your report to ${companyName}'s drug safety team (re: "${originalSubject}").\n\nTo process your report, we still need the following information. Please reply to this email with these details:`,
        listItems: missingFields,
        trailingText:
          'If you believe you already included this information, please resend it as clearly labelled lines (e.g. "Product: ...", "Reaction: ...") so it can be captured accurately.',
        recipientEmail: to,
        recipientContext: 'external',
      }),
    )
  }

  /**
   * VigiCloud testing-todo Stage 3.3 — the immediate "your report was
   * received" confirmation for a reporter-blind intake channel (public
   * URL, inbound email) that captured a real email address. Deliberately
   * separate from `sendCaseIntakeFollowUp()` above (that one asks for
   * more information; this one closes the loop once a case has actually
   * been created) and from the WhatsApp channel's own in-conversation
   * confirmation message (`ASK_PHOTO` in `whatsapp-chatbot.service.ts`) —
   * WhatsApp reporters are confirmed in-channel already, since they have
   * no email address on file at all.
   */
  async sendCaseReceivedConfirmation(
    to: string,
    companyName: string,
    referenceNumber: string,
  ): Promise<void> {
    await this.send(
      to,
      `Report received — ${companyName}`,
      NotificationEmail({
        heading: 'Thank you — your report has been received',
        eyebrow: 'Drug safety report',
        bodyText: `Thank you for reporting a safety concern to ${companyName}. Your report has been recorded and will be reviewed by their safety team. No further action is needed from you right now.\n\nYour reference number is:`,
        listItems: [referenceNumber],
        trailingText:
          'If you have more information to add, please reply to this email or use the same reporting channel again, quoting this reference number.',
        recipientEmail: to,
        recipientContext: 'external',
      }),
    )
  }

  /**
   * Every caller in this codebase treats email as best-effort: the actual
   * state change (a registration row, an invitation, a password reset
   * token) is always committed to the DB first, and every code/link this
   * sends has its own resend path. So a failure here — rendering the
   * template, Resend rejecting the request, or the network call itself
   * failing — is logged, never thrown, so a transient mail-provider,
   * network, or rendering issue can't fail the request that already
   * succeeded and strand the user behind a "still pending" state with no
   * way to retry.
   *
   * Rendering happens *inside* this method's own try/catch, not at each
   * call site, for a concrete reason found via this session's first-ever
   * e2e exercise of `InvitationsService.create()`'s email step: under this
   * project's Jest/ts-jest test environment, `@react-email/render()`
   * internally attempts a dynamic `import()` that throws
   * `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG` (no
   * `--experimental-vm-modules` flag) — and that thrown value fails
   * `instanceof Error` across the VM/module-realm boundary Jest creates,
   * so a naive `catch (error) { (error as Error).message }` at a call site
   * wouldn't even format it correctly. Every `sendX()` method used to call
   * `render()` itself and only wrap the *dispatch* step in this shared
   * try/catch — meaning a render failure (this one, or a future template
   * bug) bypassed the best-effort guarantee entirely and would 500 the
   * whole request. Centralizing render+dispatch here closes that gap for
   * every email this service sends, not just invitations.
   */
  private async send(to: string, subject: string, element: ReactElement): Promise<void> {
    let html: string
    try {
      html = await render(element)
    } catch (error) {
      // Stage 11.2 — the specific, well-known Jest/ESM incompatibility
      // this class's own doc comment above already explains in full;
      // labelled here too so the *log line itself* (not just the source
      // comment) tells a developer this isn't a real bug.
      const isKnownJestEsmIssue =
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG'
      const suffix = isKnownJestEsmIssue
        ? " (expected under Jest — a known @react-email/render ESM/VM incompatibility, not a real template bug; see MailService.send()'s own doc comment)"
        : ''
      this.logger.error(
        `Failed to render the "${subject}" email template for ${to}: ${error instanceof Error ? error.message : String(error)}${suffix}`,
      )
      return
    }

    await this.dispatch(to, subject, html)
  }

  private async dispatch(to: string, subject: string, html: string): Promise<void> {
    // Stage 11.2 — labelled up front, once, rather than making every
    // individual failure log guess at the cause.
    const suffix = this.isPlaceholderKey
      ? ' (expected — RESEND_API_KEY is the dev/test placeholder value, not a real delivery failure)'
      : ''

    try {
      const result = await this.resend.emails.send({
        from: this.fromAddress,
        to,
        subject,
        html,
      })

      if (result.error) {
        this.logger.error(`Failed to send "${subject}" to ${to}: ${result.error.message}${suffix}`)
      }
    } catch (error) {
      this.logger.error(
        `Failed to send "${subject}" to ${to}: ${error instanceof Error ? error.message : String(error)}${suffix}`,
      )
    }
  }
}
