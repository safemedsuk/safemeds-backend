import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator'

/**
 * testing-correction-explanation.md §3.6 — Withdrawal, decision #1:
 * signature-gated, matching every other signature-gated action's own
 * `signatureToken`/`intentStatement` shape (`RevealTreatmentArmDto`'s own
 * precedent) plus a required `reason` and an optional supporting document
 * (uploaded first via the generic documents endpoint against
 * `(recordType: 'product_registration', recordId: <the registration's own id>)`
 * — the registration already exists, so no holding-pair trick is needed).
 */
export class WithdrawRegistrationDto {
  @ApiProperty({ description: 'Why this registration is being withdrawn' })
  @IsString()
  @IsNotEmpty()
  reason: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  documentId?: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  intentStatement: string

  @ApiProperty({ description: 'Single-use signature token minted by POST /auth/reauth' })
  @IsString()
  @IsNotEmpty()
  signatureToken: string
}
