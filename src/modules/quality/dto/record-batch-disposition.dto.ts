import { IsIn, IsNotEmpty, IsString } from 'class-validator'

export const BATCH_RECORD_REVIEW_DISPOSITIONS = ['released', 'rejected', 'reworked'] as const

/** Mirrors every other signature-gated action in this codebase (`signatureToken`/`intentStatement`, from `SignatureModal`'s own re-auth step). */
export class RecordBatchDispositionDto {
  @IsIn(BATCH_RECORD_REVIEW_DISPOSITIONS)
  disposition!: string

  @IsString()
  @IsNotEmpty()
  intentStatement!: string

  @IsString()
  @IsNotEmpty()
  signatureToken!: string
}
