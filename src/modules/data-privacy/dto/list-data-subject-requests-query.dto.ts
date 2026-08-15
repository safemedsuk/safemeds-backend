import { ApiPropertyOptional } from '@nestjs/swagger'
import { DataSubjectRequestStatus } from '@prisma/client'
import { IsEnum, IsOptional } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListDataSubjectRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DataSubjectRequestStatus })
  @IsOptional()
  @IsEnum(DataSubjectRequestStatus)
  status?: DataSubjectRequestStatus
}
