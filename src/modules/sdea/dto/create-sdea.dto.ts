import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateSdeaDto {
  @IsString()
  distributorId!: string

  @MinLength(1)
  @MaxLength(200)
  @IsString()
  title!: string

  @MinLength(1)
  @MaxLength(200)
  @IsString()
  counterpartyName!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  templateUsed?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveDate?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiryDate?: string
}
