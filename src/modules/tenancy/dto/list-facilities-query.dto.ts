import { IsOptional, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListFacilitiesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  countryId?: string
}
