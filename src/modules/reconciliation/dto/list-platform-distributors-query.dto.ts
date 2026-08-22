import { Transform } from 'class-transformer'
import { IsBoolean, IsOptional, IsString } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

/** testing-todo 15.1 — platform-wide distributor browsing, across every tenant, for the tenant-to-tenant auto-link admin flow. */
export class ListPlatformDistributorsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  q?: string

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unlinkedOnly?: boolean
}
