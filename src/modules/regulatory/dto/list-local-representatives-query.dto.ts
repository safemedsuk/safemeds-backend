import { IsOptional, IsString } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListLocalRepresentativesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  q?: string
}
