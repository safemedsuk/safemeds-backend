import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

export const COMPLAINT_CLASSIFICATIONS = ['quality_complaint', 'possible_ae'] as const

export class ClassifyComplaintDto {
  @IsIn(COMPLAINT_CLASSIFICATIONS)
  classification!: string

  /** Only meaningful for `quality_complaint` — a `possible_ae` complaint's own seriousness lives on the routed PV case instead. */
  @IsOptional()
  @IsIn(['critical', 'major', 'minor'])
  severity?: string

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string
}
