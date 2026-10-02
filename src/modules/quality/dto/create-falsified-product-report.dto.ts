import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export const FALSIFIED_PRODUCT_REPORT_SOURCE_VALUES = [
  'market_surveillance',
  'complaint',
  'distributor',
  'regulator',
  // Reserved for when the QR/serialization scan-to-verify feature
  // exists — explicitly out of scope for this pass, see this DTO's
  // own module-level doc comment.
  'scan_feature',
] as const

export class CreateFalsifiedProductReportDto {
  @IsOptional()
  @IsUUID()
  productId?: string

  @IsOptional()
  @IsUUID()
  batchId?: string

  @IsIn(FALSIFIED_PRODUCT_REPORT_SOURCE_VALUES)
  source!: string

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  evidenceDescription!: string

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  evidenceDocumentIds?: string[]
}
