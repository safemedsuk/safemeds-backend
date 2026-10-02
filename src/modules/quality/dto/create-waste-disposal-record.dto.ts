import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export const WASTE_TYPE_VALUES = [
  'expired_stock',
  'rejected_batch',
  'recalled_stock',
  'sampling_residue',
  'other',
] as const

export class CreateWasteDisposalRecordDto {
  @IsOptional()
  @IsUUID()
  productId?: string

  @IsOptional()
  @IsUUID()
  batchId?: string

  @IsIn(WASTE_TYPE_VALUES)
  wasteType!: string

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  quantity!: string

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  unit!: string

  /**
   * A `WasteDisposalMethodCatalogEntry.methodKey` value, or a free-text
   * fallback if no catalog entry matches yet — plain string, never an
   * `IsIn`, matching `Supplier.supplierType`'s own precedent (see this
   * field's own schema doc comment for why a real catalog can slot in
   * later with zero code change).
   */
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  disposalMethod!: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  disposalFacilityName?: string

  @IsOptional()
  @IsUUID()
  disposalCertificateDocumentId?: string

  @IsDateString()
  disposedAt!: string
}
