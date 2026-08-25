import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator'

export class UpdateImportExportPermitDto {
  @IsOptional()
  @IsString()
  permitNumber?: string

  /** Plain string — `draft | active | expired | revoked`. Never delete; deactivate/revoke via this field. */
  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsDateString()
  validFrom?: string

  @IsOptional()
  @IsDateString()
  validTo?: string

  @IsOptional()
  @IsUUID()
  permitDocumentId?: string
}
