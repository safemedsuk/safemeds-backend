import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ContactTestChannel } from '@prisma/client'
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

export class StartContactTestDto {
  @ApiProperty({ enum: ContactTestChannel })
  @IsEnum(ContactTestChannel)
  channel: ContactTestChannel

  @ApiProperty({
    description:
      'The email address or phone number under test — deliberately plain string, not strictly format-validated, since a phone channel value is never an email shape',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  contactValue: string

  @ApiPropertyOptional({ description: 'e.g. "QPPV after-hours hotline", "Drug safety mailbox"' })
  @IsOptional()
  @IsString()
  purpose?: string
}
