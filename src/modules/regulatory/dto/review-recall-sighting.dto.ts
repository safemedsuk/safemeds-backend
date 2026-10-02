import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsUUID } from 'class-validator'

export const RECALL_SIGHTING_DECISIONS = ['notify_regulator', 'no_action'] as const

export class ReviewRecallSightingDto {
  @IsIn(RECALL_SIGHTING_DECISIONS)
  decision!: (typeof RECALL_SIGHTING_DECISIONS)[number]

  /** Required only when `decision === 'notify_regulator'` — the country to add via `RecallCountryService.addCountry()`. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  countryId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  regulatoryAuthorityId?: string
}
