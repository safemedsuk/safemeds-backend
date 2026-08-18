import { ProductRegistrationStatus } from '@prisma/client'
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator'

export class UpdateProductRegistrationDto {
  @IsOptional()
  @IsString()
  registrationNumber?: string

  @IsOptional()
  @IsEnum(ProductRegistrationStatus)
  status?: ProductRegistrationStatus

  @IsOptional()
  @IsDateString()
  issuedOn?: string

  @IsOptional()
  @IsDateString()
  expiresOn?: string

  @IsOptional()
  @IsUUID()
  manufacturingSiteId?: string

  @IsOptional()
  @IsUUID()
  localRepresentativeId?: string

  @IsOptional()
  @IsString()
  mahName?: string

  @IsOptional()
  @IsString()
  mahCountry?: string

  @IsOptional()
  @IsString()
  productClass?: string
}
