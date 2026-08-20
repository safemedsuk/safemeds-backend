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
}
