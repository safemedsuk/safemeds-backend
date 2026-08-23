import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator'

export class CreateManufacturingSiteDto {
  @IsUUID()
  manufacturerId!: string

  @IsString()
  siteName!: string

  @IsOptional()
  @IsUUID()
  countryId?: string

  @IsOptional()
  @IsString()
  address?: string

  @IsOptional()
  @IsString()
  gmpCertificateNumber?: string

  @IsOptional()
  @IsDateString()
  gmpCertificateExpiresOn?: string
}
