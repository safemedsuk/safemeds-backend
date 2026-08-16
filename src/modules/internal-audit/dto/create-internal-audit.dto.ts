import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateInternalAuditDto {
  @MinLength(1)
  @MaxLength(200)
  @IsString()
  title!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  scope?: string

  @IsDateString()
  scheduledDate!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  leadAuditorUserId?: string
}
