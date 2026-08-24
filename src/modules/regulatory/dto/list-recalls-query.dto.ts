import { IsOptional, IsString, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListRecallsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string

  @IsOptional()
  @IsString()
  status?: string
}
