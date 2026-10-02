import { ApiPropertyOptional } from '@nestjs/swagger'
import { ReportStatus } from '@prisma/client'
import { IsEnum, IsOptional, IsString } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListGeneratedReportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  moduleKey?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reportTypeKey?: string

  @ApiPropertyOptional({ enum: ReportStatus })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus

  /** Real-usage request, 22 Sep 2026 (item 22) — e.g. finding every report generated for a specific signal. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recordType?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recordId?: string
}
