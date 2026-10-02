import { IsUUID } from 'class-validator'

export class GenerateRecallSubmissionDto {
  @IsUUID()
  templateId!: string
}
