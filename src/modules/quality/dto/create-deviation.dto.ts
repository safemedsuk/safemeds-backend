import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator'

export const DEVIATION_SOURCE_TYPES = [
  'self_reported',
  'audit_finding',
  'oos_triggered',
  'complaint_triggered',
  'monitoring_alert',
] as const

export class CreateDeviationDto {
  @MinLength(1)
  @MaxLength(200)
  @IsString()
  title!: string

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string

  @IsIn(DEVIATION_SOURCE_TYPES)
  sourceType!: string

  @IsOptional()
  @IsUUID()
  productId?: string

  @IsOptional()
  @IsUUID()
  batchId?: string

  @IsOptional()
  @IsUUID()
  equipmentId?: string

  @IsOptional()
  @IsUUID()
  supplierId?: string

  @IsOptional()
  @IsUUID()
  sopId?: string

  @IsDateString()
  detectedAt!: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  containmentActions?: string
}
