import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator'

export class CreateProductClassDto {
  /** Omit (or pass null) for a class offered under every authority. */
  @IsOptional()
  @IsUUID()
  authorityId?: string

  @IsString()
  @MinLength(1)
  classKey!: string

  @IsString()
  @MinLength(1)
  label!: string

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
