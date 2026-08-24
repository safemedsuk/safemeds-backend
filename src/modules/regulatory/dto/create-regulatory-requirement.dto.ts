import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator'

export class RequiredDocumentDefinitionInputDto {
  @IsString()
  documentKey!: string

  @IsString()
  name!: string

  @IsOptional()
  @IsString()
  ctdModule?: string

  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean

  @IsOptional()
  @IsString()
  sourceReference?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number
}

/**
 * A new draft version of a `RegulatoryRequirement` — always a full,
 * independent snapshot, including its own checklist. There is no PATCH:
 * every edit is a new version, matching `CreateReportingRuleDto`'s own
 * version-on-write precedent exactly. `unverified` defaults to `true` at
 * the DTO level too (not just the DB default) so the admin form's own
 * "must be explicitly unchecked" UX has a real server-side backstop.
 */
export class CreateRegulatoryRequirementDto {
  @IsUUID()
  countryId!: string

  @IsUUID()
  authorityId!: string

  @IsString()
  productClass!: string

  @IsOptional()
  @IsString()
  route?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  standardTimelineDays?: number

  @IsOptional()
  @IsString()
  description?: string

  @IsOptional()
  @IsBoolean()
  unverified?: boolean

  @IsOptional()
  @IsString()
  sourceReference?: string

  @IsDateString()
  effectiveFrom!: string

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RequiredDocumentDefinitionInputDto)
  documentDefinitions?: RequiredDocumentDefinitionInputDto[]
}
