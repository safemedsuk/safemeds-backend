import { IsOptional, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListPromotionalMaterialSubmissionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string
}
