import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ClinicalTrialBlindingType } from '@prisma/client'
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator'

export class CreateClinicalTrialDto {
  @ApiProperty({
    description:
      "The protocol/registration number — e.g. an NCT number or the sponsor's own protocol ID",
  })
  @IsString()
  @MaxLength(100)
  trialReference: string

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  trialName: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sponsor?: string

  @ApiPropertyOptional({ description: 'Free text, e.g. "Phase I", "Phase II/III"' })
  @IsOptional()
  @IsString()
  phase?: string

  @ApiPropertyOptional({ enum: ClinicalTrialBlindingType, default: 'open_label' })
  @IsOptional()
  @IsEnum(ClinicalTrialBlindingType)
  blindingType?: ClinicalTrialBlindingType

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ethicsCommitteeName?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  ethicsCommitteeContactEmail?: string

  @ApiPropertyOptional({
    description:
      "A reference into the sponsor's own clinical-trial portal — SafeMeds never integrates with it directly",
  })
  @IsOptional()
  @IsString()
  clinicalTrialPortalReference?: string

  @ApiProperty()
  @IsUUID()
  countryId: string

  @ApiProperty()
  @IsDateString()
  startDate: string

  @ApiProperty({
    description:
      'Real-usage request, 22 Sep 2026 (item 19) — a trial cannot be created without proof of regulatory-authority approval. Upload the PDF first via the generic documents endpoint, then pass the resulting document id here.',
  })
  @IsUUID()
  regulatoryApprovalDocumentId: string

  @ApiProperty()
  @IsDateString()
  regulatoryApprovalDate: string

  @ApiPropertyOptional({ description: 'Omit if the approval has no expiry.' })
  @IsOptional()
  @IsDateString()
  regulatoryApprovalExpiryDate?: string

  @ApiProperty({
    description:
      'Real-usage request, 22 Sep 2026 (item 19) — a trial cannot be created without proof of ethics-committee approval, uploaded the same way as the regulatory approval above.',
  })
  @IsUUID()
  ethicsApprovalDocumentId: string

  @ApiProperty()
  @IsDateString()
  ethicsApprovalDate: string

  @ApiPropertyOptional({ description: 'Omit if the approval has no expiry.' })
  @IsOptional()
  @IsDateString()
  ethicsApprovalExpiryDate?: string
}
