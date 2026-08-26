import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export class CreateSafetyAlertDto {
  @MinLength(1)
  @MaxLength(200)
  @IsString()
  title!: string

  @MinLength(1)
  @MaxLength(200)
  @IsString()
  source!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceUrl?: string

  @MinLength(1)
  @MaxLength(5000)
  @IsString()
  summary!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('7')
  affectedProductId?: string
}
