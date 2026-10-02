import { RegVariationType } from '@prisma/client'
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator'

export class CreateRegVariationDto {
  @IsUUID()
  productRegistrationId!: string

  /** testing-correction-explanation.md §2.2 — Kenya's real, confirmed 4-category variation taxonomy, plus `renewal` (see `RegVariation`'s own schema doc comment). */
  @IsEnum(RegVariationType)
  variationType!: RegVariationType

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
