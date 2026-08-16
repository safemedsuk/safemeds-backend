import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

const STATUSES = ['open', 'in_progress', 'pending_effectiveness_check', 'closed'] as const

export class UpdateCapaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  correctiveAction?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  preventiveAction?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerUserId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string

  @ApiPropertyOptional({ enum: STATUSES.filter((s) => s !== 'closed') })
  @IsOptional()
  @IsIn(STATUSES.filter((s) => s !== 'closed'))
  status?: (typeof STATUSES)[number]
}
