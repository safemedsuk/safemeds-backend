import { createHmac, timingSafeEqual } from 'crypto'

export interface SvixSignatureHeaders {
  id: string
  timestamp: string
  signature: string
}

const DEFAULT_TOLERANCE_SECONDS = 5 * 60

/**
 * Verifies a Svix-style webhook signature — Resend's inbound-email webhook
 * (and most modern webhook providers) sign this way: HMAC-SHA256 over
 * `${id}.${timestamp}.${rawBody}`, keyed by the base64 portion of a
 * `whsec_...`-prefixed secret, compared against one of the
 * space-separated `v1,<base64>` values in the signature header. `rawBody`
 * must be the exact bytes received — a re-serialized JSON string isn't
 * guaranteed to byte-match (see `main.ts`'s `rawBody: true`).
 *
 * Rejects timestamps outside `toleranceSeconds` of now, so a captured
 * request can't be replayed indefinitely.
 */
export function verifySvixSignature(
  rawBody: Buffer,
  headers: SvixSignatureHeaders,
  secret: string,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
): boolean {
  const timestampSeconds = Number(headers.timestamp)
  if (!Number.isFinite(timestampSeconds)) return false
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > toleranceSeconds) return false

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const signedContent = `${headers.id}.${headers.timestamp}.${rawBody.toString('utf8')}`
  const expected = createHmac('sha256', secretBytes).update(signedContent).digest()

  return headers.signature.split(' ').some((candidate) => {
    const [version, sig] = candidate.split(',')
    if (version !== 'v1' || !sig) return false
    const sigBuffer = Buffer.from(sig, 'base64')
    return sigBuffer.length === expected.length && timingSafeEqual(sigBuffer, expected)
  })
}
