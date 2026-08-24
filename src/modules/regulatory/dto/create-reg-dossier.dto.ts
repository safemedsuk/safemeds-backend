import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator'

import { ENGAGEMENT_TYPES } from '../engagement-model.service'

export class CreateRegDossierDto {
  @IsUUID()
  productId!: string

  @IsUUID()
  authorityId!: string

  @IsString()
  productClass!: string

  @IsOptional()
  @IsString()
  route?: string

  /**
   * RegCloud (Phase 12) Stage 12 — set when this dossier *is* a Clinical
   * Trial Application. Unlike `productRegistrationId` (deliberately hidden
   * from this DTO — see `RegDossierService.create()`'s own doc comment),
   * this is safe to expose directly: any tenant user creating a dossier
   * against their own company's own trial is legitimate, no invariant to
   * protect.
   */
  @IsOptional()
  @IsUUID()
  clinicalTrialId?: string

  /**
   * RegCloud (Phase 12) Stage 15 — per-dossier override of the company's
   * own default engagement model. Optional — omit to use whatever the
   * company profile already has set.
   */
  @IsOptional()
  @IsIn(ENGAGEMENT_TYPES)
  engagementType?: string

  /**
   * RegCloud (Phase 12) Stage 16 — set when this dossier is one of the
   * submissions grouped under a `RelianceApplication`. Not surfaced on
   * the public create form directly — `RelianceApplicationService` is
   * the one caller that sets this, exactly mirroring how
   * `productRegistrationId` is only ever set by `RegVariationService`
   * calling `RegDossierService.create()` in-process. Still declared here
   * (unlike `productRegistrationId`) since, like `clinicalTrialId`,
   * there's no invariant to protect — any tenant user linking a dossier
   * to their own company's reliance application is legitimate.
   */
  @IsOptional()
  @IsUUID()
  relianceApplicationId?: string
}
