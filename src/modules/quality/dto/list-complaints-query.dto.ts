import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'
import { COMPLAINT_CLASSIFICATIONS } from './classify-complaint.dto'

export class ListComplaintsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  q?: string

  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsIn(COMPLAINT_CLASSIFICATIONS)
  classification?: string

  @IsOptional()
  @IsUUID()
  productId?: string
}
