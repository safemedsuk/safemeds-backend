import { IsOptional, IsString, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListOosQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsUUID()
  batchId?: string
}
