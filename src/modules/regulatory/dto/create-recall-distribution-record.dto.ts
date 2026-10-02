import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator'

export class CreateRecallDistributionRecordDto {
  @IsUUID()
  batchId!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  fromOrgId?: string

  @IsUUID()
  toOrgId!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  qtyPacks?: number

  @IsInt()
  @Min(0)
  qtyUnits!: number

  @IsDateString()
  date!: string

  @IsOptional()
  @IsString()
  sourceRef?: string
}
