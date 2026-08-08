/**
 * AES-256-GCM, key from MFA_ENCRYPTION_KEY (64 hex chars = 32 bytes).
 * Output: base64(iv || authTag || ciphertext).
 *
 * The actual algorithm now lives in `src/common/encryption/aes-gcm.util.ts`
 * (moved there for VigiCloud Stage 0.3's text-level encryption, which
 * reuses the exact same primitive under a different key) — this file
 * re-exports under the original names so `reauth.service.ts`/
 * `mfa.service.ts` don't need to change.
 */
export {
  decryptWithKey as decryptSecret,
  encryptWithKey as encryptSecret,
} from '../../../common/encryption/aes-gcm.util'
