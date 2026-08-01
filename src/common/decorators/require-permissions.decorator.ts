import { SetMetadata } from '@nestjs/common'

export const PERMISSIONS_KEY = 'requiredPermissions'

/**
 * Gates a route behind one or more `domain.action` permission keys
 * (resolved from the caller's `roleKeys`/`platformRole` via `RolesService`
 * — see `PermissionsGuard`). Multiple permissions are ANDed: the caller
 * needs all of them. Routes with no `@RequirePermissions()` are
 * unaffected — this is opt-in, same pattern as `@Public()` is opt-out for
 * `JwtAuthGuard`.
 */
export function RequirePermissions(...permissions: string[]) {
  return SetMetadata(PERMISSIONS_KEY, permissions)
}
