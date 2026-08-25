import { IsOptional, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListRelianceApplicationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string
}
