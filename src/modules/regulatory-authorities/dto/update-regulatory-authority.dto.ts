import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator'

/** Every field editable except `countryId` — an authority never moves country; create a new one instead. */
export class UpdateRegulatoryAuthorityDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  code?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string

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

  /** Must match a filename (without extension) actually present in `assets/emblems/`, or the literal empty string to clear it. Never a free-typed value; validated server-side. */
  @IsOptional()
  @IsString()
  emblemAssetKey?: string
}
