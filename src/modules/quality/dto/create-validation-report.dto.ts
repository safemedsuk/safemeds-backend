import { IsIn, IsObject, IsOptional, IsUUID } from 'class-validator'

export const VALIDATION_CONCLUSION_VALUES = ['validated', 'not_validated', 'conditionally_validated'] as const

export class CreateValidationReportDto {
  @IsOptional()
  @IsObject()
  executionRecords?: Record<string, unknown>

  @IsOptional()
  @IsUUID()
  reportDocumentId?: string

  @IsOptional()
  @IsIn(VALIDATION_CONCLUSION_VALUES)
  conclusion?: string
}
