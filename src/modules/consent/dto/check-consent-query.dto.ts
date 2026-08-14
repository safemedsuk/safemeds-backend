import { ApiProperty } from '@nestjs/swagger'
import { ConsentType } from '@prisma/client'
import { IsEnum, IsNotEmpty, IsString } from 'class-validator'

export class CheckConsentQueryDto {
  @ApiProperty()
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
}
