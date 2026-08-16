import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

const STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const

export class UpdateInternalAuditDto {
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  scope?: string
}
