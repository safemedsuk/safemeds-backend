import { IsIn, IsOptional, IsString } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'
import { CHANGE_CONTROL_SCOPES } from './create-change-control.dto'

export class ListChangeControlsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  q?: string

  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsIn(CHANGE_CONTROL_SCOPES)
  scope?: string
}
