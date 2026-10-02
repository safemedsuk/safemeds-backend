import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator'

/** Deliberately never touches `authorityId`/`sectionKey` (the natural key) or `mappedRecordType` (which resolver backs a row is an engineering change, not config) — matches `UpdateRequirementDefinitionDto`'s own exact narrowness. */
export class UpdateInspectionChecklistTemplateDto {
  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  @IsString()
  description?: string

  @IsOptional()
  @IsString()
  guidelineReference?: string

  @IsOptional()
  @IsInt()
  sortOrder?: number

  @IsOptional()
  @IsBoolean()
  unverified?: boolean

  @IsOptional()
  @IsBoolean()
  active?: boolean
}
