import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export const VALIDATION_TYPE_VALUES = [
  'process',
  'cleaning',
  'analytical_method',
  'computer_system',
] as const

export const VALIDATION_PROCESS_APPROACH_VALUES = [
  'traditional_three_batch',
  'continued_process_verification',
] as const

export const GAMP_CATEGORY_VALUES = [
  '1_infrastructure',
  '3_non_configured',
  '4_configured',
  '5_custom',
] as const

export class CreateValidationProtocolDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string

  @IsIn(VALIDATION_TYPE_VALUES)
  validationType!: string

  @IsOptional()
  @IsIn(VALIDATION_PROCESS_APPROACH_VALUES)
  approach?: string

  @IsOptional()
  @IsIn(GAMP_CATEGORY_VALUES)
  gampCategory?: string

  @IsOptional()
  @IsUUID()
  productId?: string

  @IsOptional()
  @IsUUID()
  equipmentId?: string

  @IsOptional()
  @IsString()
  nextRevalidationDueAt?: string
}
