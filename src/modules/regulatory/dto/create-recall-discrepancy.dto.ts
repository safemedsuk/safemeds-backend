import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, MinLength } from 'class-validator'

export class CreateRecallDiscrepancyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  recallCountryId?: string

  @IsInt()
  units!: number

  @IsString()
  @MinLength(1)
  reason!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerUserId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  blocking?: boolean
}
