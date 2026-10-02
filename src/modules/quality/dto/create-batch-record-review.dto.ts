import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'

export class CreateBatchRecordReviewDto {
  @IsUUID()
  batchId!: string

  @IsOptional()
  @IsUUID()
  mbrDocumentId?: string

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  reviewFindings?: string
}
