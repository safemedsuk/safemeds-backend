import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

const STATUSES = ['ready', 'needs_update', 'expiring', 'missing'] as const

export class UpdateAuditRequirementDto {
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  documentId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string

  @ApiPropertyOptional({
    description: 'Freeform checklist state — only meaningful for the QMS nine-elements row',
  })
  @IsOptional()
  checklistJson?: Record<string, unknown>
}
