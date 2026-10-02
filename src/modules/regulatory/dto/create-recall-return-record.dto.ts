import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator'

export class CreateRecallReturnRecordDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  fromOrgId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  batchScannedGtin?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  batchScannedLot?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  batchScannedExpiry?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  batchScannedSerial?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  batchId?: string

  @IsInt()
  @Min(0)
  qty!: number
}
