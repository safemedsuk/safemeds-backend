import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

export const OOS_BATCH_IMPACTS = [
  'no_impact',
  'batch_rejected',
  'batch_reworked',
  'other_batches_affected',
] as const

export class RecordOosPhase2Dto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  findings?: string

  @IsOptional()
  @IsIn(OOS_BATCH_IMPACTS)
  batchImpact?: string
}
