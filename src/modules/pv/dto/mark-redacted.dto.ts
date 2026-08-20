import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsUUID } from 'class-validator'

/** VigiCloud Stage 3.7 — the redacted-copy upload slot, distinct from the original. `redactedDocumentId` must already exist as a `Document` uploaded against the same case (via the generic Phase 8 handshake) before it can be linked here — this endpoint never uploads bytes itself, exactly like `LinkSourceDocumentDto`. */
export class MarkRedactedDto {
  @ApiPropertyOptional({
    description:
      'An already-uploaded Document ID to link as the redacted copy — optional, the flag alone is still valid without one',
  })
  @IsOptional()
  @IsUUID()
  redactedDocumentId?: string
}
