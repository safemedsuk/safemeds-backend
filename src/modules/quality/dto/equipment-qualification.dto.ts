import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export const EQUIPMENT_QUALIFICATION_STAGE_VALUES = ['dq', 'iq', 'oq', 'pq'] as const
export const EQUIPMENT_QUALIFICATION_RESULT_VALUES = ['pass', 'fail'] as const

export class RecordEquipmentQualificationEventDto {
  @IsIn(EQUIPMENT_QUALIFICATION_STAGE_VALUES)
  stage!: 'dq' | 'iq' | 'oq' | 'pq'

  @IsIn(EQUIPMENT_QUALIFICATION_RESULT_VALUES)
  @IsOptional()
  result?: 'pass' | 'fail'

  @IsOptional()
  @IsUUID()
  protocolDocumentId?: string

  @IsOptional()
  @IsUUID()
  reportDocumentId?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}

export class CreateMaintenanceRecordDto {
  @IsDateString()
  maintenanceDate!: string

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  description!: string

  @IsOptional()
  @IsDateString()
  nextDueAt?: string
}
