import { IsOptional, IsString, IsUUID } from 'class-validator'

export class CreateRegVariationDto {
  @IsUUID()
  productRegistrationId!: string

  /** Kenya's own real variation-classification category names are unconfirmed (see `RegVariation`'s own schema doc comment) — plain free-text, with `'renewal'` the one value this build gives real meaning to. */
  @IsString()
  variationType!: string

  /** Defaults to the target registration's own current product/authority/class/route when omitted — a variation is, by default, "the same registration, revised." */
  @IsOptional()
  @IsUUID()
  productId?: string

  @IsOptional()
  @IsUUID()
  authorityId?: string

  @IsOptional()
  @IsString()
  productClass?: string

  @IsOptional()
  @IsString()
  route?: string
}
