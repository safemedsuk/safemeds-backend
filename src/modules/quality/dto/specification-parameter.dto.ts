import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator'

export class SpecificationParameterDto {
  @MinLength(1)
  @MaxLength(200)
  @IsString()
  parameterName!: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  testMethod?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lowerLimit?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  upperLimit?: string

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number
}
