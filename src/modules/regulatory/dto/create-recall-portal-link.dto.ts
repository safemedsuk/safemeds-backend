import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator'

export const RECALL_PORTAL_LANGUAGES = ['en', 'fr', 'pt'] as const

export class CreateRecallPortalLinkDto {
  @IsUUID()
  stakeholderId!: string

  @ApiPropertyOptional({ enum: RECALL_PORTAL_LANGUAGES })
  @IsOptional()
  @IsIn(RECALL_PORTAL_LANGUAGES)
  language?: (typeof RECALL_PORTAL_LANGUAGES)[number]

  /** Days until expiry — default 14, per the build spec's own default. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  expiresInDays?: number
}
