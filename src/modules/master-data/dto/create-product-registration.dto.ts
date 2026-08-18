import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator'

export class CreateProductRegistrationDto {
  @IsUUID()
  productId!: string

  @IsUUID()
  authorityId!: string

  @IsString()
  registrationNumber!: string

  @IsDateString()
  issuedOn!: string

  @IsDateString()
  expiresOn!: string

  /**
   * RegCloud (Phase 12) Stage 0.2 fields — all optional, since this
   * endpoint predates RegCloud (base-engine Phase 7) and a registration
   * can still be created with none of them, exactly like `Product.innName`
   * etc. before it (see that field's own doc comment for the precedent).
   */
  @IsOptional()
  @IsUUID()
  manufacturingSiteId?: string

  @IsOptional()
  @IsUUID()
  localRepresentativeId?: string

  @IsOptional()
  @IsString()
  mahName?: string

  @IsOptional()
  @IsString()
  mahCountry?: string

  @IsOptional()
  @IsString()
  productClass?: string
}
