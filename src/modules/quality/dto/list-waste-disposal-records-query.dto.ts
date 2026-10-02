import { IsOptional, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListWasteDisposalRecordsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  batchId?: string

  @IsOptional()
  @IsUUID()
  productId?: string
}
