import { IsOptional, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListBatchesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string
}
