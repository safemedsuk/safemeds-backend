import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString } from 'class-validator'

/**
 * VigiCloud Stage 14 — mirrors the shape every other signature-gated
 * action in this codebase already accepts (`signatureToken`/
 * `intentStatement`, from `SignatureModal`'s own re-auth step), plus a
 * `reason` specific to this action: unblinding is a big enough event
 * that "why" is its own required field, not folded into the generic
 * intent statement.
 */
export class RevealTreatmentArmDto {
  @ApiProperty({
    description:
      'Why the treatment arm needs to be revealed now — e.g. for SAE causality assessment',
  })
  @IsString()
  @IsNotEmpty()
  reason: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  intentStatement: string

  @ApiProperty({ description: 'Single-use signature token minted by POST /auth/reauth' })
  @IsString()
  @IsNotEmpty()
  signatureToken: string
}
