import { IsOptional, IsString } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListDistributorsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  q?: string
}
