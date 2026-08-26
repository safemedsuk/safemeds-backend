import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

const STATUSES = ['reviewed', 'actioned', 'dismissed'] as const

export class UpdateSafetyAlertStatusDto {
  @IsIn(STATUSES)
  status!: (typeof STATUSES)[number]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewNote?: string
}
