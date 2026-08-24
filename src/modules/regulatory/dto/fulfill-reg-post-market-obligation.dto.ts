import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator'

export class FulfillRegPostMarketObligationDto {
  /** The tenant's own proof of having filed this with the regulator. */
  @IsOptional()
  @IsUUID()
  evidenceDocumentId?: string

  /** Convenience action — produces a real, honest internal filing-record PDF (never fabricated regulatory content) via `RegPostMarketObligationPdfService`, stored as a `GeneratedReport`. Can be combined with `evidenceDocumentId` in the same call. */
  @IsOptional()
  @IsBoolean()
  generateFilingRecord?: boolean

  @IsOptional()
  @IsString()
  note?: string
}
