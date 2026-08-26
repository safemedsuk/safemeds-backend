import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export class CreateRmpDto {
  @IsUUID('7')
  productId!: string

  @MinLength(1)
  @MaxLength(200)
  @IsString()
  title!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  summary?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  nextRenewalDueAt?: string
}
