import { Type } from 'class-transformer'
import { IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator'

export class ImpactDimensionDto {
  @IsBoolean()
  impacted!: boolean

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string
}

/**
 * QualCloud (Phase 13) Stage 4 — the real structured impact-assessment
 * checklist, never free text alone: each dimension a yes/no + note.
 * `regulatoryImpact.impacted` is what `ChangeControlService
 * .openLinkedVariation()` and the `impact_assessment → approved` guard
 * both key off.
 */
export class AssessChangeImpactDto {
  @ValidateNested()
  @Type(() => ImpactDimensionDto)
  regulatoryImpact!: ImpactDimensionDto

  @ValidateNested()
  @Type(() => ImpactDimensionDto)
  validationImpact!: ImpactDimensionDto

  @ValidateNested()
  @Type(() => ImpactDimensionDto)
  productSafetyImpact!: ImpactDimensionDto

  @ValidateNested()
  @Type(() => ImpactDimensionDto)
  stabilityImpact!: ImpactDimensionDto

  @ValidateNested()
  @Type(() => ImpactDimensionDto)
  otherSpecificationsImpact!: ImpactDimensionDto
}
