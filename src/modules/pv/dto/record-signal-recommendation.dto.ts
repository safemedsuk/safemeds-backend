import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

const RECOMMENDATION_ACTIONS = [
  'request_more_data',
  'propose_product_info_update',
  'request_rmp_update',
  'propose_risk_minimisation',
  'sponsor_followup_study',
  'no_action',
] as const

export class RecordSignalRecommendationDto {
  @IsIn(RECOMMENDATION_ACTIONS)
  recommendationAction!: (typeof RECOMMENDATION_ACTIONS)[number]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  recommendationNote?: string
}
