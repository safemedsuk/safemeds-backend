import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator'

export const FALSIFIED_PRODUCT_REPORT_SOURCE_VALUES = [
  'market_surveillance',
  'complaint',
  'distributor',
  'regulator',
  // Real-usage item (7 Oct 2026) — the camera/barcode scan reporting
  // path. `scannedCode` carries whatever the scanner (or manual entry,
  // where the browser has no barcode-scanning API) read.
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

  @IsOptional()
  @IsString()
  @MaxLength(300)
  scannedCode?: string

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
