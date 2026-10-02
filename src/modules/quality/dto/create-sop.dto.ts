import { IsDateString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export class CreateSopDto {
  @MinLength(1)
  @MaxLength(50)
  @IsString()
  documentNumber!: string

  @MinLength(1)
  @MaxLength(200)
  @IsString()
  title!: string

  /**
   * Plain string — `sop | policy | specification_reference |
   * master_batch_record | work_instruction | form | protocol | report` —
   * WHO GMP's own document-hierarchy taxonomy, not enforced as a
   * hardcoded enum (matching `Sop.documentType`'s own schema comment).
   */
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  documentType!: string

  @IsOptional()
  @IsUUID()
  productId?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  processArea?: string

  @IsOptional()
  @IsDateString()
  nextPeriodicReviewDueAt?: string
}
