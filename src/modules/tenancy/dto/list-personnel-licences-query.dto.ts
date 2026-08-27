import { IsOptional, IsString, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListPersonnelLicencesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string

  @IsOptional()
  @IsString()
  status?: string
}
