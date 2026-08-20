import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { PatientSex } from '@prisma/client'
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

export class EnrollTrialSubjectDto {
  @ApiProperty({
    description:
      'A blinded subject identifier — never a name, matching Patient.initials\' own "never a full name" discipline',
  })
  @IsString()
  @MaxLength(50)
  subjectCode: string

  @ApiPropertyOptional({ enum: PatientSex, default: 'unknown' })
  @IsOptional()
  @IsEnum(PatientSex)
  sex?: PatientSex

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(130)
  ageYears?: number

  @ApiProperty()
  @IsDateString()
  enrolledAt: string

  @ApiPropertyOptional({
    description:
      "The sponsor's randomization assignment, if already known at enrollment — encrypted at rest, blinded by default, never returned by any read endpoint",
  })
  @IsOptional()
  @IsString()
  treatmentArm?: string
}
