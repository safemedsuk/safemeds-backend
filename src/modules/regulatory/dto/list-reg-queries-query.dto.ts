import { Transform } from 'class-transformer'
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'
import { REG_QUERY_STATUSES } from '../reg-query.service'

/**
 * CEO feedback, 30 Sep 2026 — "Register view: all queries across
 * products and markets, filterable by market, product, owner and
 * status, with overdue queries highlighted." The cross-dossier register
 * this powers (`GET /reg-queries`) is genuinely new — the pre-existing
 * `GET /reg-dossiers/:dossierId/queries` stays scoped to one dossier,
 * unchanged, for the dossier detail page's own correspondence panel.
 */
export class ListRegQueriesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('7')
  productId?: string

  /** "Market" = the query's own dossier's authority's country. */
  @IsOptional()
  @IsUUID('7')
  countryId?: string

  @IsOptional()
  @IsUUID('7')
  ownerUserId?: string

  @IsOptional()
  @IsIn(REG_QUERY_STATUSES)
  status?: string

  /** True → only queries past their `responseDueDate` and not yet `responded`/`closed`. */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  overdueOnly?: boolean
}
