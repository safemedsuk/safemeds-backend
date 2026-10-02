import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListRecallsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string

  @IsOptional()
  @IsString()
  status?: string

  /** QualCloud (Phase 13) Stage 10.7 — lets the frontend reuse this same list for the Mock Recalls screen, filtering by `mode` rather than a parallel screen/family. */
  @IsOptional()
  @IsIn(['real', 'mock'])
  mode?: string
}
