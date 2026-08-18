import { ProductCategory } from '@prisma/client'
import { ArrayMaxSize, IsArray, IsDateString, IsEnum, IsOptional, IsString } from 'class-validator'

export class CreateProductDto {
  @IsString()
  brandName!: string

  @IsString()
  genericName!: string

  @IsEnum(ProductCategory)
  productCategory!: ProductCategory

  @IsString()
  dosageForm!: string

  @IsString()
  strength!: string

  /** The WHO International Nonproprietary Name — distinct from `genericName`, this company's own preferred generic label. */
  @IsOptional()
  @IsString()
  innName?: string

  /**
   * Not required — WHO's ATC classification only meaningfully applies to
   * `medicinal`/`vaccine` categories, not every `ProductCategory` (see
   * the schema's own doc comment on `Product.atcCode`).
   */
  @IsOptional()
  @IsString()
  atcCode?: string

  /** Release-profile detail (e.g. "extended release"), distinct from `dosageForm` (tablet/capsule/injection). */
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

  /** VigiCloud Stage 18 — the EURD-list anchor date for PSUR/PBRER periodicity (see `Product.internationalBirthDate`'s own schema doc comment). */
  @IsOptional()
  @IsDateString()
  internationalBirthDate?: string
}
