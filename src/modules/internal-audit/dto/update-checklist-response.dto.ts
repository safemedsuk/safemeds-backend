import { IsIn, IsOptional, IsString } from 'class-validator'

export const CHECKLIST_RESPONSE_STATUSES = [
  'not_reviewed',
  'compliant',
  'non_compliant',
  'not_applicable',
] as const

export class UpdateChecklistResponseDto {
  @IsIn(CHECKLIST_RESPONSE_STATUSES)
  status!: (typeof CHECKLIST_RESPONSE_STATUSES)[number]

  @IsOptional()
  @IsString()
  observations?: string
}
