import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString } from 'class-validator'

export const RECALL_RETURN_VERDICTS = ['genuine', 'suspect', 'mismatched_batch', 'expired'] as const

export class VerifyRecallReturnRecordDto {
  @IsIn(RECALL_RETURN_VERDICTS)
  verdict!: (typeof RECALL_RETURN_VERDICTS)[number]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  verdictNote?: string
}
