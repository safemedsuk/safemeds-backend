import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsOptional, IsUUID } from 'class-validator'

export class GenerateReconciliationReportDto {
  @ApiPropertyOptional({
    description:
      'Scope the report to one distributor — omit for a whole-company report across every listed distributor plus the unmatched queue',
  })
  @IsOptional()
  @IsUUID()
  distributorId?: string

  @ApiProperty()
  @IsDateString()
  periodStart: string

  @ApiProperty()
  @IsDateString()
  periodEnd: string
}
