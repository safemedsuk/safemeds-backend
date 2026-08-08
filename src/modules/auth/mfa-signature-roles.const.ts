/**
 * Tenant roles the build spec names explicitly for `SecurityPolicy
 * .mfaRequiredForSignatureRoles` (1.6/1.10): QPPV, Quality Manager, and
 * Regulatory Affairs Officer sign or approve regulated records elsewhere
 * in the platform. Phase 2 introduces the full role/permission catalog —
 * until then this is the same simplified roleKeys-array check Phase 1
 * uses everywhere else in place of RLS.
 */
export const SIGNATURE_GATED_ROLE_KEYS = [
  'QPPV',
  'QUALITY_MANAGER',
  'REGULATORY_AFFAIRS_OFFICER',
] as const

export function hasSignatureGatedRole(roleKeys: string[]): boolean {
  return roleKeys.some((key) => (SIGNATURE_GATED_ROLE_KEYS as readonly string[]).includes(key))
}
