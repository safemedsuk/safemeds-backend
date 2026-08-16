import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator'

/**
 * Deliberately narrow: `source` and `requirementKey` are never editable
 * here — changing which resolver backs a row (or un-tethering a
 * `system_generated` row from its resolver) is a real engineering
 * change, not a config edit. `active` (soft-delete/deactivate, never
 * hard-delete, matching this project's own convention everywhere else)
 * is the only lifecycle field.
 */
export class UpdateRequirementDefinitionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  sortOrder?: number

  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  description?: string

  /** Pass an empty string to clear it back to null. */
  @IsOptional()
  @IsString()
  guidelineReference?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  evidenceArtifactType?: string

  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean

  @IsOptional()
  @IsBoolean()
  active?: boolean
}
