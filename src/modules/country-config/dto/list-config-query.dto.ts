import { IsOptional, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListConfigQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  authorityId?: string

  @IsOptional()
  @IsUUID()
  reportTypeId?: string

  @IsOptional()
  @IsUUID()
  countryId?: string
}
