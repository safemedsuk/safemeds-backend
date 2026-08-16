import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator'

const CREATABLE_SOURCES = ['person_uploads'] as const

/**
 * Only `person_uploads` is creatable through this endpoint — a
 * `system_generated` row has no meaning without a matching resolver
 * function in `AuditReadinessService`, which only an engineer can add.
 * See that service's own doc comment and the Admin Configuration
 * Console plan for the full reasoning.
 */
export class CreateRequirementDefinitionDto {
  @IsUUID()
  authorityId!: string

  @IsString()
  @MinLength(1)
  requirementKey!: string

  @IsInt()
  @Min(1)
  sortOrder!: number

  @IsString()
  @MinLength(1)
  title!: string

  @IsString()
  @MinLength(1)
  description!: string

  @IsOptional()
  @IsString()
  guidelineReference?: string

  @IsIn(CREATABLE_SOURCES)
  source!: (typeof CREATABLE_SOURCES)[number]

  @IsString()
  @MinLength(1)
  evidenceArtifactType!: string

  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean
}
