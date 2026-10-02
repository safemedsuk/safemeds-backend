import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

export const RISK_METHOD_VALUES = [
  'fmea',
  'fault_tree',
  'risk_matrix_2x2',
  'haccp',
  'other',
] as const

export class CreateRiskAssessmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sourceRecordType?: string

  @IsOptional()
  @IsString()
  sourceRecordId?: string

  @MinLength(1)
  @MaxLength(200)
  @IsString()
  title!: string

  @IsOptional()
  @IsIn(RISK_METHOD_VALUES)
  riskMethod?: string

  @IsInt()
  @Min(1)
  @Max(5)
  severity!: number

  @IsInt()
  @Min(1)
  @Max(5)
  probability!: number

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  detectability?: number

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  mitigationActions?: string

  @IsOptional()
  @IsUUID()
  capaId?: string
}
