import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator'

import { EQUIPMENT_QUALIFICATION_STATUS_VALUES } from './create-equipment.dto'

export class UpdateEquipmentDto {
  @IsOptional()
  @IsUUID()
  facilityId?: string

  @IsOptional()
  @MinLength(1)
  @MaxLength(200)
  @IsString()
  name?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  equipmentType?: string

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
