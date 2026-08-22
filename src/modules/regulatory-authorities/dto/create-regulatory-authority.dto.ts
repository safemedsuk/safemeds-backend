import { IsEmail, IsOptional, IsString, IsUUID, MinLength } from 'class-validator'

export class CreateRegulatoryAuthorityDto {
  @IsUUID()
  countryId!: string

  @IsString()
  @MinLength(1)
  code!: string

  @IsString()
  @MinLength(1)
  name!: string

  @IsOptional()
  @IsString()
  formCode?: string

  @IsOptional()
  @IsString()
  ministryName?: string

  @IsOptional()
  @IsString()
  poBoxAddress?: string

  @IsOptional()
  @IsString()
  phone?: string

  @IsOptional()
  @IsEmail()
  contactEmail?: string

  /** Must match a filename (without extension) actually present in `assets/emblems/` — see `GET /regulatory-authorities/emblem-assets`. Never a free-typed value; validated server-side. */
  @IsOptional()
  @IsString()
  emblemAssetKey?: string
}
