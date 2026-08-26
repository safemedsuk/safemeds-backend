import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsOptional, IsUUID } from 'class-validator'

export class GenerateLineListingDto {
  /** Plain `@IsUUID()`, not version-pinned — matches `CreatePvCaseDto.countryOfOccurrenceId`'s own precedent, since a `Country` row's id isn't guaranteed to be a v7 UUID the way this module's own `newId()`-generated entities are. */
  @IsUUID()
  countryId!: string

  /** Both required together for a custom/on-demand range; omit both to use the country's own configured cadence. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  periodStart?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  periodEnd?: string
}
