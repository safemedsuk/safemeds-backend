import { IsOptional, IsString, IsUUID, Length } from 'class-validator'

export class UpdateFacilityDto {
  @IsOptional()
  @IsUUID()
  countryId?: string

  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string

  @IsOptional()
  @IsString()
  facilityCode?: string

  @IsOptional()
  @IsString()
  county?: string

  @IsOptional()
  @IsString()
  subCounty?: string

  @IsOptional()
  @IsString()
  address?: string

  @IsOptional()
  @IsString()
  phone?: string
}
