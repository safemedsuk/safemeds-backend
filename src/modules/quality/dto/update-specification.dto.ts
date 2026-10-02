import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator'

import { SpecificationParameterDto } from './specification-parameter.dto'

export class UpdateSpecificationDto {
  @IsOptional()
  @MinLength(1)
  @MaxLength(200)
  @IsString()
  title?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  specificationType?: string

  @IsOptional()
  @IsUUID()
  productId?: string

  @IsOptional()
  @IsUUID()
  supplierId?: string

  /**
   * When present, fully replaces the specification's own parameter set
   * (delete-all-then-recreate, inside the same transaction as every
   * other write here) — a specification's parameter list is small and
   * edited as a whole, not row-by-row, matching how the intake form
   * itself presents it.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SpecificationParameterDto)
  parameters?: SpecificationParameterDto[]
}
