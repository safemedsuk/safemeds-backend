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

  /** Real-usage request, 22 Sep 2026 — see `Sdea.receivedDate`'s own schema doc comment for the full account of why this is distinct from `effectiveDate`. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  receivedDate?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveDate?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiryDate?: string
}
