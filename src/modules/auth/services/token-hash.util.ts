import { createHash } from 'crypto'

/**
 * SHA-256 hex digest for high-entropy, server-generated single-use secrets
 * (recovery codes, AuthToken plaintexts, invitation tokens, refresh
 * tokens). These are never user-chosen and never brute-forceable, so a
 * fast deterministic hash is correct here — unlike passwords, which use
 * argon2id via `PasswordService`.
 */
export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}
