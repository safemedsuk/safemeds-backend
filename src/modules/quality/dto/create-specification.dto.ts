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

export class CreateSpecificationDto {
  @MinLength(1)
  @MaxLength(50)
  @IsString()
  specificationNumber!: string

  @MinLength(1)
  @MaxLength(200)
  @IsString()
  title!: string

  /** Plain string — `finished_product | raw_material | api | packaging | in_process`. */
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  specificationType!: string

  @IsOptional()
  @IsUUID()
  productId?: string

  @IsOptional()
  @IsUUID()
  supplierId?: string

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SpecificationParameterDto)
  parameters?: SpecificationParameterDto[]
}
