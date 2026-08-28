import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator'

export class UpdatePersonnelLicenceDto {
  @IsOptional()
  @IsString()
  licenceNumber?: string

  @IsOptional()
  @IsDateString()
  issuedOn?: string

  @IsOptional()
  @IsDateString()
  expiresOn?: string

  /** `active | expired | suspended | revoked` — plain string. Never delete; deactivate via this field. */
  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsUUID()
  licenceDocumentId?: string
}
