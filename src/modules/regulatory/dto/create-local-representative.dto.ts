import { IsEmail, IsOptional, IsString, IsUUID } from 'class-validator'

export class CreateLocalRepresentativeDto {
  @IsString()
  name!: string

  @IsOptional()
  @IsUUID()
  countryId?: string

  @IsOptional()
  @IsEmail()
  contactEmail?: string

  @IsOptional()
  @IsString()
  contactPhone?: string

  @IsOptional()
  @IsString()
  address?: string
}
