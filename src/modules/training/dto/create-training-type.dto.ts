import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator'

export class CreateTrainingTypeDto {
  /** Omit (or pass null) for a generic type available to every market — e.g. "Internal", "Other". */
  @IsOptional()
  @IsUUID()
  countryId?: string

  @IsString()
  @MinLength(1)
  typeKey!: string

  @IsString()
  @MinLength(1)
  label!: string

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number

  @IsOptional()
  @IsBoolean()
  active?: boolean
}
