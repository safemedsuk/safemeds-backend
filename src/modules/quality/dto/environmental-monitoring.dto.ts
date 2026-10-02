import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'

export const CLEANROOM_GRADE_VALUES = ['A', 'B', 'C', 'D'] as const
export const MONITORING_TYPE_VALUES = [
  'viable_air',
  'viable_surface',
  'viable_personnel',
  'non_viable_particle',
] as const

export class RecordEnvironmentalMonitoringResultDto {
  @IsUUID()
  facilityId!: string

  @IsIn(CLEANROOM_GRADE_VALUES)
  cleanroomGrade!: 'A' | 'B' | 'C' | 'D'

  @IsIn(MONITORING_TYPE_VALUES)
  monitoringType!: 'viable_air' | 'viable_surface' | 'viable_personnel' | 'non_viable_particle'

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sampleLocation?: string

  @IsString()
  @MaxLength(100)
  result!: string

  /** Overrides the EU GMP Annex 1 default for this grade/type — admin-configurable, never hardcoded-only. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  alertLimit?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  actionLimit?: string

  @IsDateString()
  sampledAt!: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}
