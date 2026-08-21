import { ArrayUnique, IsArray, IsString } from 'class-validator'

/** Always a full replace — the UI always shows and submits the complete intended permission set, matching `UpdateUserRolesDto`'s own full-replace precedent, so a stale partial request can never silently leave a permission half-applied. */
export class UpdateRolePermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions!: string[]
}
