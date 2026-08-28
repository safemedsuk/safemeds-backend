import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator'

export class UpdateFacilityLicenceDto {
  @IsOptional()
  @IsString()
  licenceNumber?: string

  @IsOptional()
  @IsDateString()
  licenceIssuedOn?: string

  /**
   * Always the tenant's own directly-entered, authoritative value — a
   * facility's own premises licence has no single natural `RegulatoryAuthority`
   * the way a product registration does (a country can have several —
   * e.g. Kenya's PPB, NVIP, and the synthetic Ethics Committee authority
   * all coexist), so unlike `ProductRegistration.expiresOn` this is never
   * auto-computed from a `RegDeadlineRule` — a deliberate, documented
   * scope decision (see `FacilitiesService.updateLicence()`'s own doc
   * comment), not an oversight.
   */
  @IsOptional()
  @IsDateString()
  licenceExpiresOn?: string

  @IsOptional()
  @IsString()
  licenceStatus?: string

  @IsOptional()
  @IsUUID()
  licenceDocumentId?: string
}
