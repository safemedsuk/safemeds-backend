import { IsIn } from 'class-validator'

import { VALIDATION_CONCLUSION_VALUES } from './create-validation-report.dto'

export class FinalizeValidationReportDto {
  @IsIn(VALIDATION_CONCLUSION_VALUES)
  conclusion!: string
}
