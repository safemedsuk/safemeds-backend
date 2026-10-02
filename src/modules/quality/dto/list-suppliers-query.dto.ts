import { IsIn, IsOptional, IsString } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'
import { SUPPLIER_APPROVAL_STATUS_VALUES } from './update-supplier.dto'

export class ListSuppliersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  q?: string

  @IsOptional()
  @IsIn(['critical', 'non_critical'])
  criticality?: string

  @IsOptional()
  @IsIn(SUPPLIER_APPROVAL_STATUS_VALUES)
  approvalStatus?: string
}
