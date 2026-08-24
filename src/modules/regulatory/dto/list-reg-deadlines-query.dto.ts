import { DeadlineStatus } from '@prisma/client'
import { IsEnum, IsOptional } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListRegDeadlinesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(DeadlineStatus)
  status?: DeadlineStatus
}
