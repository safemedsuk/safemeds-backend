import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListRegistrationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string

  /** Trigram search over registrationNumber. */
  @IsOptional()
  @IsString()
  q?: string

  /** Powers the future RegCloud renewals query — registrations whose expiresOn falls within the next N days. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expiringWithinDays?: number
}
