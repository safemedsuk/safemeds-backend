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
}
