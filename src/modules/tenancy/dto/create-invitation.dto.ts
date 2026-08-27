import {
  ArrayMinSize,
  ArrayUnique,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
} from 'class-validator'

export class CreateInvitationDto {
  @IsEmail()
  email!: string

  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayUnique()
  roleKeys!: string[]

  /** RegCloud (Phase 12) Stage 15 — the "multi-client consultant" case; see `User.isExternal`'s own schema doc comment. */
  @IsOptional()
  @IsBoolean()
  isExternal?: boolean
}
