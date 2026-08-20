import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { DuplicateResolutionPattern } from '@prisma/client'
import { IsEnum, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator'

/**
 * VigiCloud Stage 10 — confirming a `DuplicateReview` as a real duplicate.
 * `resolutionPattern` selects which of the EMA guideline's two Master
 * Case patterns applies; `masterCaseId` is only meaningful (and required)
 * for `allocation`, since `creation` always synthesizes a brand-new case
 * — see `DuplicateDetectionService.confirmDuplicate()`.
 */
export class ConfirmDuplicateDto {
  @ApiProperty({ enum: DuplicateResolutionPattern })
  @IsEnum(DuplicateResolutionPattern)
  resolutionPattern: DuplicateResolutionPattern

  @ApiPropertyOptional({
    description:
      'Required when resolutionPattern is "allocation" — must be either this review\'s caseId or matchedCaseId, whichever should become the Master Case',
  })
  @ValidateIf((o: ConfirmDuplicateDto) => o.resolutionPattern === 'allocation')
  @IsUUID()
  masterCaseId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reviewNote?: string
}
