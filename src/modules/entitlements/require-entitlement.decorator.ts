import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common'

import { EntitlementGuard } from './entitlement.guard'
import { MODULE_LEVEL_FEATURE_KEY } from './entitlements.service'

export const ENTITLEMENT_KEY = 'requiredEntitlement'

export interface RequiredEntitlement {
  moduleKey: string
  featureKey: string
}

/**
 * Gates a route behind a company's module/feature entitlement (Stage
 * 0.5 — "the monetisation layer"). Same opt-in shape as `@PlatformOnly`:
 * applying this decorator both attaches the metadata `EntitlementGuard`
 * reads and wires the guard onto the route, so no global registration is
 * needed in `app.module.ts` — only modules that actually gate a feature
 * this way need `EntitlementsModule` in their imports.
 */
export function RequireEntitlement(moduleKey: string, featureKey?: string) {
  return applyDecorators(
    SetMetadata(ENTITLEMENT_KEY, { moduleKey, featureKey: featureKey ?? MODULE_LEVEL_FEATURE_KEY }),
    UseGuards(EntitlementGuard),
  )
}
