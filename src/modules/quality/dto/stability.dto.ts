import { Type } from 'class-transformer'
import { IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator'

export const STORAGE_CONDITION_VALUES = [
  'long_term_30c_75rh',
  'intermediate_30c_65rh',
  'accelerated_40c_75rh',
  'long_term_25c_60rh',
] as const

export class CreateStabilityStudyDto {
  @IsUUID()
  productId!: string

  @IsOptional()
  @IsUUID()
  batchId?: string

  @IsOptional()
  @IsUUID()
  specificationId?: string

  @IsIn(STORAGE_CONDITION_VALUES)
  storageCondition!:
    | 'long_term_30c_75rh'
    | 'intermediate_30c_65rh'
    | 'accelerated_40c_75rh'
    | 'long_term_25c_60rh'

  @IsDateString()
  startDate!: string

  /** Defaults to the standard ICH Q1A(R2) schedule (0,3,6,9,12,18,24,36 months) when omitted. */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  timepointMonths?: number[]
}

export class StabilityTimepointResultDto {
  @IsUUID()
  parameterId!: string

  @IsString()
  result!: string
}

export class RecordStabilityTimepointResultsDto {
  @IsDateString()
  pullDate!: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StabilityTimepointResultDto)
  results!: StabilityTimepointResultDto[]
}

export class UpdateStabilityStudyStatusDto {
  @IsIn(['in_progress', 'completed', 'terminated'])
  status!: 'in_progress' | 'completed' | 'terminated'
}
