import { IsIn, IsOptional } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListFalsifiedProductReportsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['reported', 'confirmed', 'dismissed', 'closed'])
  status?: string
}
