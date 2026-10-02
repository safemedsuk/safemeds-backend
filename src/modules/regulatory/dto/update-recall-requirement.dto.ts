import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator'

export const RECALL_REQUIREMENT_STATUSES = [
  'open',
  'in_progress',
  'complete',
  'waived',
  'deadline_pending',
] as const

export class UpdateRecallRequirementDto {
  @ApiPropertyOptional({ enum: RECALL_REQUIREMENT_STATUSES })
  @IsOptional()
  @IsIn(RECALL_REQUIREMENT_STATUSES)
  status?: (typeof RECALL_REQUIREMENT_STATUSES)[number]

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceIds?: string[]
}
