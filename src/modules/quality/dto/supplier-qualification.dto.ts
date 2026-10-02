import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'

export const SUPPLIER_DISPOSITION_VALUES = ['accepted', 'rejected', 'quarantined'] as const

export class SupplierQuestionnaireCriterionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  question!: string

  @IsInt()
  @Min(1)
  @Max(10)
  weight!: number

  @IsInt()
  @Min(0)
  @Max(10)
  score!: number

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string
}

export class AssessSupplierDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SupplierQuestionnaireCriterionDto)
  criteria!: SupplierQuestionnaireCriterionDto[]
}

export class ScheduleSupplierAuditDto {
  @IsString()
  @MinLength(1)
  scheduledDate!: string

  @IsOptional()
  @IsUUID()
  leadAuditorUserId?: string
}

export class ApproveSupplierDto {
  @IsIn(['approved', 'suspended', 'disqualified'])
  approvalStatus!: 'approved' | 'suspended' | 'disqualified'

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string
}

export class MonitorSupplierDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  flag!: string
}

export class CoaResultEntryDto {
  @IsUUID()
  parameterId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  parameterName!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  resultValue!: string
}

export class CreateCoaDto {
  @IsUUID()
  supplierId!: string

  @IsUUID()
  materialSpecificationId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  batchOrLotNumber!: string

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CoaResultEntryDto)
  results!: CoaResultEntryDto[]
}

export class ReviewCoaDto {
  @IsIn(SUPPLIER_DISPOSITION_VALUES)
  disposition!: 'accepted' | 'rejected' | 'quarantined'
}
