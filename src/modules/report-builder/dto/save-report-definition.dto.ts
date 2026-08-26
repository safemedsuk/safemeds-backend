import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator'

import { BuildReportQueryDto } from './build-report-query.dto'

export class SaveReportDefinitionDto extends BuildReportQueryDto {
  @MinLength(1)
  @IsString()
  name!: string

  /** How often this definition auto-re-runs (as a fresh export) — omit for a one-off, never-scheduled report. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  scheduleCadenceDays?: number
}
