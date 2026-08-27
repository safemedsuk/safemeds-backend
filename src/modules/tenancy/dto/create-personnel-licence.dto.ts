import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator'

export class CreatePersonnelLicenceDto {
  @IsUUID()
  userId!: string

  /** Plain string, not an enum — e.g. `pharmacist`, `superintendent_pharmacist` — the exact real category list is still a content question, matching every other such field in this document. */
  @IsString()
  licenceType!: string

  @IsString()
  licenceNumber!: string

  @IsDateString()
  issuedOn!: string

  @IsOptional()
  @IsDateString()
  expiresOn?: string

  @IsOptional()
  @IsUUID()
  licenceDocumentId?: string
}
