import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator'

export class CreateRoleTrainingCurriculumDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  roleKey!: string

  @IsUUID()
  trainingTypeId!: string

  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  recertificationIntervalMonths?: number

  @IsOptional()
  @IsString()
  @MaxLength(100)
  documentTypeTrigger?: string
}
