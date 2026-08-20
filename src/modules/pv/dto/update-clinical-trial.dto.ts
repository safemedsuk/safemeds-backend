import { ApiPropertyOptional } from '@nestjs/swagger'
import { ClinicalTrialStatus } from '@prisma/client'
import { IsEnum, IsOptional, IsString } from 'class-validator'

/**
 * Never-delete, per this schema's own standing convention — a trial's
 * lifecycle moves through `status` (active → completed/terminated),
 * never removed. Only the fields that legitimately change after a
 * trial's protocol is set up are editable here — `trialReference`/
 * `countryId`/`startDate` are treated as fixed identity, matching how
 * `UpdateProductDto` leaves a product's own natural key alone too.
 */
export class UpdateClinicalTrialDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  trialName?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sponsor?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phase?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ethicsCommitteeName?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ethicsCommitteeContactEmail?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clinicalTrialPortalReference?: string

  @ApiPropertyOptional({ enum: ClinicalTrialStatus })
  @IsOptional()
  @IsEnum(ClinicalTrialStatus)
  status?: ClinicalTrialStatus
}
