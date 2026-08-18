import { CompanyRegistrationStatus } from '@prisma/client'
import { IsEnum, IsOptional } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListRegistrationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(CompanyRegistrationStatus)
  status?: CompanyRegistrationStatus
}
