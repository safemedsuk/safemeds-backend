/**
 * The envelope Resend's inbound-email webhook (and, by convention, most
 * "email-to-webhook" providers — SendGrid Inbound Parse, Postmark
 * Inbound, Mailgun Routes) POST: a Svix-style `{ type, data }` event
 * wrapper around a parsed MIME message.
 *
 * Deliberately a **plain interface, not a class-validator DTO** — the
 * app's global `ValidationPipe` runs with `whitelist: true,
 * forbidNonWhitelisted: true`, which would silently strip (or, worse,
 * 400-reject) any field on a real third-party payload that isn't
 * decorated here, and this payload's exact shape is genuinely owned by
 * an external vendor, not this codebase. Nest's `ValidationPipe` only
 * validates when the parameter's reflected type is a class; an
 * interface has no runtime type at all, so it passes through
 * unvalidated — `EmailIntakeService`/`EmailIntakeController` do their
 * own lenient, manual checks on the fields they actually need.
 */
export interface InboundEmailWebhookPayload {
  type?: string
  data: {
    /** A bare address string, or `{ email, name }` — providers vary. */
    from?: string | { email?: string; name?: string }
    /** The recipient address(es) — used to resolve which tenant's mailbox this is. Some providers send a bare string, others a one-element array. */
    to?: string | string[]
    subject?: string
    /** Plain-text body — the preferred extraction source over `html`. */
    text?: string
    html?: string
    /** The MIME `Message-Id` header, if present — stored as `Case.sourceChannelReference` for traceability back to the original email. */
    messageId?: string
  }
}
