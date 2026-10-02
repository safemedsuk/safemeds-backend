import { Type } from 'class-transformer'
import { IsDateString, IsInt, IsUUID, Max, Min } from 'class-validator'

export class CreateRegRetentionDto {
  @IsUUID()
  productRegistrationId!: string

  /** The calendar year being retained (e.g. `2026`) — at most one per (registration, year), enforced by `RegRetention`'s own DB-level unique constraint. */
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number

  /** The real date the retention fee was paid. */
  @IsDateString()
  paidAt!: string
}
