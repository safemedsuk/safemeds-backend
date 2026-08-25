import { IsOptional, IsUUID } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListRegDossiersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string

  /** RegCloud (Phase 12) Stage 12 — lets the Clinical Trial Detail page list only the CTA dossiers filed for one specific trial. */
  @IsOptional()
  @IsUUID()
  clinicalTrialId?: string

  /** RegCloud (Phase 12) Stage 16 — lets the Reliance Application Detail page list only the dossiers filed under one specific application. */
  @IsOptional()
  @IsUUID()
  relianceApplicationId?: string
}
