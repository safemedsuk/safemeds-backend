import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator'

export const EQUIPMENT_QUALIFICATION_STATUS_VALUES = [
  'not_qualified',
  'dq_complete',
  'iq_complete',
  'oq_complete',
  'pq_complete',
  'qualified',
  'requalification_due',
  'disqualified',
] as const

export class CreateEquipmentDto {
  @IsOptional()
  @IsUUID()
  facilityId?: string

  @MinLength(1)
  @MaxLength(200)
  @IsString()
  name!: string

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  equipmentType!: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  assetTag?: string

  @IsOptional()
  @IsIn(EQUIPMENT_QUALIFICATION_STATUS_VALUES)
  qualificationStatus?: string

  @IsOptional()
  @IsDateString()
  calibrationDueAt?: string

  @IsOptional()
  @IsDateString()
  lastCalibratedAt?: string

  @IsOptional()
  @IsDateString()
  maintenanceDueAt?: string
}
