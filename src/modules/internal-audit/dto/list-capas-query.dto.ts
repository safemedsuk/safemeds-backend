import { IsOptional, IsString } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

/** QualCloud (Phase 13) Stage 3 — the unified CAPA screen's own "filterable by source type" requirement. */
export class ListCapasQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  sourceRecordType?: string

  @IsOptional()
  @IsString()
  status?: string
}
