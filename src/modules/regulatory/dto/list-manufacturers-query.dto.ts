import { IsOptional, IsString } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListManufacturersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  q?: string
}
