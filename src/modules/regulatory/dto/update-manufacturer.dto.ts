import { IsOptional, IsString, IsUUID } from 'class-validator'

export class UpdateManufacturerDto {
  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsUUID()
  countryId?: string

  @IsOptional()
  @IsString()
  address?: string
}
