import { IsIn, IsOptional } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'
import { VALIDATION_TYPE_VALUES } from './create-validation-protocol.dto'

export class ListValidationProtocolsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(VALIDATION_TYPE_VALUES)
  validationType?: string
}
