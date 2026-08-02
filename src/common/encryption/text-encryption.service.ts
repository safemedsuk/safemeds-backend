import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { EnvConfig } from '../../config/env.validation'
import { decryptWithKey, encryptWithKey } from './aes-gcm.util'

/**
 * VigiCloud Stage 0.3 — text-level encryption at rest. The base engine
 * already encrypts documents (Phase 8, R2 server-side) and MFA secrets
 * (Phase 1.6); free-text fields (case narratives, transcribed
 * voice-to-text, and similar) were the one Tier 0 gap the Final build
 * spec explicitly calls out ("Done for documents; ENFORCE at text
 * level"). No live column consumes this yet — VigiCloud Stage 1's
 * `AdverseEvent.narrative`/`Case.additionalInformation` will be the
 * first — but the primitive is built, tested, and ready now rather than
 * retrofitted later, per Tier 0's own "cannot be retrofitted" framing.
 *
 * Keyed by its own `TEXT_ENCRYPTION_KEY` env var, deliberately separate
 * from `MFA_ENCRYPTION_KEY` — a TOTP secret and a patient narrative have
 * different blast radii if a key is ever rotated or compromised, and
 * keeping them independent means rotating one never touches the other.
 */
@Injectable()
export class TextEncryptionService {
  constructor(private readonly configService: ConfigService<EnvConfig, true>) {}

  encrypt(plaintext: string): string {
    return encryptWithKey(plaintext, this.configService.get('TEXT_ENCRYPTION_KEY', { infer: true }))
  }

  decrypt(ciphertext: string): string {
    return decryptWithKey(
      ciphertext,
      this.configService.get('TEXT_ENCRYPTION_KEY', { infer: true }),
    )
  }
}
