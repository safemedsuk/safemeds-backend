import { ArrayUnique, IsBoolean, IsOptional, IsString } from 'class-validator'

export class UpdateUserRolesDto {
  @IsString({ each: true })
  @ArrayUnique()
  roleKeys!: string[]

  /** RegCloud (Phase 12) Stage 15 — lets an already-active account's external/internal status be toggled after invite time (e.g. an internal employee later becomes a multi-client consultant). Omit to leave it unchanged. */
  @IsOptional()
  @IsBoolean()
  isExternal?: boolean
}
