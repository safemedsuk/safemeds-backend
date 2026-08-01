import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * Generic AES-256-GCM encrypt/decrypt, keyed by a 64-hex-char (32-byte)
 * key. Originally written specifically for MFA's TOTP secret
 * (`mfa-encryption.util.ts`) and moved here unchanged so any other
 * at-rest secret — starting with VigiCloud Stage 0.3's text-level
 * encryption of free-text narrative fields — reuses the exact same,
 * already-reviewed primitive instead of a second hand-rolled copy.
 * `mfa-encryption.util.ts` now just re-exports from here.
 */
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

/** Output: base64(iv || authTag || ciphertext). */
export function encryptWithKey(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex')
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([iv, authTag, ciphertext]).toString('base64')
}

export function decryptWithKey(encoded: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex')
  const raw = Buffer.from(encoded, 'base64')

  const iv = raw.subarray(0, IV_LENGTH)
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
