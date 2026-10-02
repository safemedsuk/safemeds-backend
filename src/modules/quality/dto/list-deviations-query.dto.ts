import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListDeviationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  q?: string

  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsIn(['critical', 'major', 'minor'])
  severity?: string

  @IsOptional()
  @IsUUID()
  productId?: string
}
