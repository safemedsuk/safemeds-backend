import { IsOptional, IsString, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListSpecificationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  q?: string

  @IsOptional()
  @IsUUID()
  productId?: string

  @IsOptional()
  @IsUUID()
  supplierId?: string

  @IsOptional()
  @IsString()
  specificationType?: string
}
