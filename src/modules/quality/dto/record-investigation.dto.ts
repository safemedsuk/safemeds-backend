import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'

export const ROOT_CAUSE_METHODS = [
  'five_why',
  'fishbone_ishikawa',
  'fault_tree',
  'is_is_not',
  'other',
] as const

export class RecordInvestigationDto {
  @IsOptional()
  @IsIn(ROOT_CAUSE_METHODS)
  rootCauseMethod?: string

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  findings?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  evidenceReferences?: string

  @IsOptional()
  @IsUUID()
  investigatorUserId?: string

  @IsOptional()
  @IsUUID()
  reviewerUserId?: string
}
