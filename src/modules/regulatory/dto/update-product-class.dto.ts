import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator'

/** Deliberately narrow, matching `UpdateTrainingTypeDto`'s own precedent — `authorityId`/`classKey` are the row's own identity and never change after creation; only presentation fields are editable. */
export class UpdateProductClassDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string

  @IsOptional()
  @IsString()
  description?: string

  @IsOptional()
  @IsString()
  sourceReference?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number

  @IsOptional()
  @IsBoolean()
  active?: boolean
}
