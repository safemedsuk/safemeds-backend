import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export const RECALL_MESSAGE_CHANNELS = ['whatsapp', 'sms', 'email'] as const

export class SendRecallMessageDto {
  @IsUUID()
  stakeholderId!: string

  @IsIn(RECALL_MESSAGE_CHANNELS)
  channel!: (typeof RECALL_MESSAGE_CHANNELS)[number]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  templateId?: string

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string
}
