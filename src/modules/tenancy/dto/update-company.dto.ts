import { IsIn, IsOptional, IsString, Length } from 'class-validator'

const ENGAGEMENT_TYPES = ['full_service', 'dossier_review_only', 'client_handles_queries'] as const

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string

  /** RegCloud (Phase 12) Stage 15 — the company's default engagement model; see `Company.engagementType`'s own schema doc comment. */
  @IsOptional()
  @IsIn(ENGAGEMENT_TYPES)
  engagementType?: string
}
