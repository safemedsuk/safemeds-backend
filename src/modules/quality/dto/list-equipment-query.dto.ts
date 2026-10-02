import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'
import { EQUIPMENT_QUALIFICATION_STATUS_VALUES } from './create-equipment.dto'

export class ListEquipmentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  q?: string

  @IsOptional()
  @IsUUID()
  facilityId?: string

  @IsOptional()
  @IsIn(EQUIPMENT_QUALIFICATION_STATUS_VALUES)
  qualificationStatus?: string
}
