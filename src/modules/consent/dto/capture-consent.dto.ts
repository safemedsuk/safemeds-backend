import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ConsentMethod, ConsentType } from '@prisma/client'
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator'

export class CaptureConsentDto {
  @ApiProperty({ description: 'Polymorphic target, e.g. "pv_case"' })
  @IsString()
  @IsNotEmpty()
  recordType: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  recordId: string

  @ApiProperty({ enum: ConsentType })
  @IsEnum(ConsentType)
  consentType: ConsentType

  @ApiProperty({ description: 'True if consent was given, false if explicitly declined' })
  @IsBoolean()
  granted: boolean

  @ApiProperty({ enum: ConsentMethod })
  @IsEnum(ConsentMethod)
  method: ConsentMethod

  @ApiPropertyOptional({
    description: 'Which version of the consent-form wording was in effect',
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  formVersion?: number
}
