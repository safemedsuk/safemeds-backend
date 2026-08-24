import { IsOptional, IsString, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListImportExportPermitsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string

  @IsOptional()
  @IsString()
  status?: string

  /** RegCloud (Phase 12) Stage 12 — lets the Clinical Trial Detail page list only the IMP permits linked to one specific trial. */
  @IsOptional()
  @IsUUID()
  clinicalTrialId?: string
}
