import { IsOptional, IsString, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListManufacturingSitesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  manufacturerId?: string

  @IsOptional()
  @IsString()
  q?: string
}
