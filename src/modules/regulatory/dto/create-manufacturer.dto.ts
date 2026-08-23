import { IsOptional, IsString, IsUUID } from 'class-validator'

export class CreateManufacturerDto {
  @IsString()
  name!: string

  @IsOptional()
  @IsUUID()
  countryId?: string

  @IsOptional()
  @IsString()
  address?: string
}
