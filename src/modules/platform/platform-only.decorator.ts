import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common'

import { PlatformGuard } from './platform.guard'

export const PLATFORM_ROLES_KEY = 'platformRoles'

/**
 * Guards a route to platform staff only. Pass specific roles to narrow
 * further (e.g. `@PlatformOnly('super_admin')`); no args means any
 * authenticated platform user.
 *
 * This is a simplified version of what Phase 2.3 formally builds — the
 * audited `withPlatformAccess()` wrapper for cross-tenant reads is not
 * implemented yet.
 */
export function PlatformOnly(...roles: string[]) {
  return applyDecorators(SetMetadata(PLATFORM_ROLES_KEY, roles), UseGuards(PlatformGuard))
}
