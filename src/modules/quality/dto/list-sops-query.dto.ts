import { IsOptional, IsString, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListSopsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  q?: string

  @IsOptional()
  @IsUUID()
  productId?: string

  @IsOptional()
  @IsString()
  documentType?: string

  @IsOptional()
  @IsString()
  status?: string
}
