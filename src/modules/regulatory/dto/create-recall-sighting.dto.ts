import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export class CreateRecallSightingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  country!: string

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  source!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  evidenceDocumentId?: string
}
