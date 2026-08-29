import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator'

/** Deliberately narrow, matching `RequirementDefinitionAdminService`'s own precedent — `countryId`/`typeKey` are the row's own identity and never change after creation; only presentation fields are editable. */
export class UpdateTrainingTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number

  @IsOptional()
  @IsBoolean()
  active?: boolean
}
