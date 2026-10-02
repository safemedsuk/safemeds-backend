import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export const CHANGE_CONTROL_TYPES = ['like_for_like', 'minor', 'major', 'critical'] as const
export const CHANGE_CONTROL_SCOPES = [
  'process',
  'equipment',
  'facility',
  'supplier',
  'sop',
  'specification',
  'packaging',
  'labeling',
] as const

export class CreateChangeControlDto {
  @MinLength(1)
  @MaxLength(200)
  @IsString()
  title!: string

  @IsIn(CHANGE_CONTROL_TYPES)
  changeType!: string

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  changeDescription?: string

  @IsIn(CHANGE_CONTROL_SCOPES)
  scope!: string

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

  @IsOptional()
  @IsUUID()
  affectedProductRegistrationId?: string
}
