import { IsOptional, IsString, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListRegConfigQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  countryId?: string

  @IsOptional()
  @IsUUID()
  authorityId?: string

  @IsOptional()
  @IsString()
  productClass?: string
}
