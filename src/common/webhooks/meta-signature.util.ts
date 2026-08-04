import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verifies Meta's `X-Hub-Signature-256` header (WhatsApp Cloud API,
 * and every other Meta Graph API webhook, sign this way): HMAC-SHA256
 * over the exact raw request body, keyed by the app secret, formatted
 * as `sha256=<hex digest>`. A different scheme from Resend/Svix's (see
 * `svix-signature.util.ts`) — hex, not base64, no id/timestamp
 * components, no replay-window concept of its own.
 */
export function verifyMetaSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false

  const provided = signatureHeader.slice('sha256='.length)
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex')

  const providedBuffer = Buffer.from(provided, 'hex')
  const expectedBuffer = Buffer.from(expected, 'hex')
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  )
}
