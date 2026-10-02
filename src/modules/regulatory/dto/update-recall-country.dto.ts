import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString } from 'class-validator'

export const RECALL_COUNTRY_STATUSES = [
  'pending',
  'notified',
  'in_progress',
  'reporting',
  'closure_submitted',
  'closed_by_regulator',
] as const

export class UpdateRecallCountryDto {
  @ApiPropertyOptional({ enum: RECALL_COUNTRY_STATUSES })
  @IsOptional()
  @IsIn(RECALL_COUNTRY_STATUSES)
  status?: (typeof RECALL_COUNTRY_STATUSES)[number]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  regulatorDecision?: string
}
