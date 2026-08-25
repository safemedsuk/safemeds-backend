import { IsOptional, IsString, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListRegPostMarketObligationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  productRegistrationId?: string

  @IsOptional()
  @IsString()
  status?: string
}
