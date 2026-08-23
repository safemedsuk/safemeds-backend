import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator'

export class CreateImportExportPermitDto {
  @IsUUID()
  productId!: string

  @IsOptional()
  @IsUUID()
  productRegistrationId?: string

  @IsUUID()
  authorityId!: string

  /** Plain string — `import | export`. */
  @IsString()
  permitType!: string

  @IsOptional()
  @IsString()
  permitNumber?: string

  @IsOptional()
  @IsDateString()
  validFrom?: string

  @IsOptional()
  @IsDateString()
  validTo?: string

  @IsOptional()
  @IsUUID()
  permitDocumentId?: string

  /** RegCloud (Phase 12) Stage 12 — set when this permit is for a trial's own IMP import/export rather than a commercial product. */
  @IsOptional()
  @IsUUID()
  clinicalTrialId?: string
}
