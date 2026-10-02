import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'

export const COMPETENCY_ASSESSMENT_METHODS = [
  'written_test',
  'practical_observation',
  'supervisor_signoff',
] as const
export const COMPETENCY_ASSESSMENT_RESULTS = ['competent', 'not_yet_competent'] as const

export class CreateCompetencyAssessmentDto {
  @IsUUID()
  trainingRecordId!: string

  @IsIn(COMPETENCY_ASSESSMENT_METHODS)
  assessmentMethod!: 'written_test' | 'practical_observation' | 'supervisor_signoff'

  @IsIn(COMPETENCY_ASSESSMENT_RESULTS)
  result!: 'competent' | 'not_yet_competent'

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}
