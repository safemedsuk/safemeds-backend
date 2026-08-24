import {
  IsBoolean,
  IsDateString,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator'

/**
 * `amount` is `@IsNumberString()`, not `@IsNumber()` — it's forwarded
 * straight into Prisma's `Decimal` field, and accepting the string form
 * avoids any floating-point round-trip through JS `number` for a monetary
 * value (the same reasoning any `Decimal`-backed DTO in this ecosystem
 * follows).
 */
export class CreateRegulatoryFeeScheduleDto {
  @IsUUID()
  countryId!: string

  @IsUUID()
  authorityId!: string

  @IsString()
  productClass!: string

  @IsOptional()
  @IsString()
  route?: string

  @IsString()
  feeType!: string

  @IsNumberString()
  amount!: string

  @IsOptional()
  @IsString()
  currency?: string

  @IsOptional()
  @IsBoolean()
  unverified?: boolean

  @IsOptional()
  @IsString()
  sourceReference?: string

  @IsDateString()
  effectiveFrom!: string
}
