import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator'

export class CreateRegPostMarketObligationDto {
  @IsUUID()
  productRegistrationId!: string

  @IsString()
  obligationType!: string

  /** Required only when no active `RegDeadlineRule` resolves for this registration's `(country, authority, productClass, obligationType)` — see `RegPostMarketObligationService.create()`'s own `DUE_DATE_REQUIRED` error. */
  @IsOptional()
  @IsDateString()
  dueAt?: string
}
