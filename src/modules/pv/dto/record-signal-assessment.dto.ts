import { IsString, MaxLength, MinLength } from 'class-validator'

export class RecordSignalAssessmentDto {
  @MinLength(1)
  @MaxLength(2000)
  @IsString()
  assessmentNote!: string
}
