import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export const RECALL_SUBMISSION_TEMPLATE_FORMATS = ['pdf'] as const

export class CreateRecallSubmissionTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  code!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string

  @IsOptional()
  @IsIn(RECALL_SUBMISSION_TEMPLATE_FORMATS)
  format?: (typeof RECALL_SUBMISSION_TEMPLATE_FORMATS)[number]
}
