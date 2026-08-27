import { UserStatus } from '@prisma/client'
import { IsEnum, IsOptional, IsString } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus

  /** A single `roleKeys` entry to filter by, e.g. `?role=QPPV`. */
  @IsOptional()
  @IsString()
  role?: string
}
