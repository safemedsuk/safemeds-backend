import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator'

export class CreateRoleDto {
  /** Upper-snake-case for tenant roles (matches `SUPERINTENDENT_PHARMACIST`); lower-snake-case for platform roles (matches the `PlatformRole` enum) — enforced loosely (letters/digits/underscore only) since the two populations use different casing conventions by design. */
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9_]*$/, {
    message: 'key must be letters, digits, and underscores only',
  })
  key!: string

  @IsString()
  @MinLength(1)
  name!: string

  @IsString()
  @MinLength(1)
  description!: string

  @IsOptional()
  @IsBoolean()
  isPlatform?: boolean

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions!: string[]
}
