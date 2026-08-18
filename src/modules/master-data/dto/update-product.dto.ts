import { ProductCategory } from '@prisma/client'
import { ArrayMaxSize, IsArray, IsDateString, IsEnum, IsOptional, IsString } from 'class-validator'

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  brandName?: string

  @IsOptional()
  @IsString()
  genericName?: string

  @IsOptional()
  @IsEnum(ProductCategory)
  productCategory?: ProductCategory

  @IsOptional()
  @IsString()
  dosageForm?: string

  @IsOptional()
  @IsString()
  strength?: string

  @IsOptional()
  @IsString()
  innName?: string

  @IsOptional()
  @IsString()
  atcCode?: string

  @IsOptional()
  @IsString()
  formulation?: string

  @IsOptional()
  @IsString()
  routeOfAdministration?: string

  @IsOptional()
  @IsString()
  siteOfManufacture?: string

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  packSizes?: string[]

  @IsOptional()
  @IsDateString()
  internationalBirthDate?: string
}
