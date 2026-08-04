import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class QueryAuditDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  recordType?: string

  @IsOptional()
  @IsString()
  recordId?: string

  @IsOptional()
  @IsUUID()
  actorId?: string

  @IsOptional()
  @IsString()
  action?: string

  @IsOptional()
  @IsDateString()
  from?: string

  @IsOptional()
  @IsDateString()
  to?: string

  /**
   * Platform staff only (requires `platform.audit.read`) — narrows a
   * cross-tenant query down to one company. Silently ignored for tenant
   * callers, whose `companyId` is always forced from their own session.
   */
  @IsOptional()
  @IsUUID()
  companyId?: string
}
