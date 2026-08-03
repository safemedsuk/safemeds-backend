/**
 * The 8 tenant-side roles from `docs/safemeds-user-types.md`. Phase 2 seeds
 * the full `Role`/`Permission` catalog and validates against it for real;
 * until then this static list is the stand-in `roleKeys` are checked
 * against everywhere a Phase 1 endpoint needs to validate or gate on them
 * (invitations, admin actions).
 */
export const TENANT_ROLE_KEYS = [
  'SYSTEM_ADMINISTRATOR',
  'DISPENSING_PHARMACIST',
  'SUPERINTENDENT_PHARMACIST',
  'QPPV',
  'QUALITY_ASSOCIATE',
  'QUALITY_MANAGER',
  'REGULATORY_AFFAIRS_OFFICER',
  'EXECUTIVE_READONLY',
] as const

export type TenantRoleKey = (typeof TENANT_ROLE_KEYS)[number]

export function isValidTenantRoleKey(key: string): key is TenantRoleKey {
  return (TENANT_ROLE_KEYS as readonly string[]).includes(key)
}

/** `SYSTEM_ADMINISTRATOR` -> `System Administrator`. Phase 2's Role catalog carries real display labels; this is a Phase 1 stand-in for emails/UI. */
export function formatRoleLabel(key: string): string {
  return key
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * The real, human-facing labels — mirrors the frontend's own
 * `lib/tenant-roles.ts` `TENANT_ROLES` exactly (same duplication
 * pattern as `TENANT_ROLE_KEYS` itself: each side keeps its own copy
 * until Phase 2's fetched `/roles` catalog replaces both). Deliberately
 * separate from `formatRoleLabel()` above, whose naive
 * split-and-capitalize gets `QPPV` wrong (`"Qppv"`) — this table is the
 * source of truth wherever a real label round-trip matters, e.g.
 * VigiCloud Stage 0.6's bulk-import CSV, which accepts these labels as
 * input so a business user preparing a spreadsheet never has to know
 * the raw enum key.
 */
export const TENANT_ROLE_LABELS: Record<TenantRoleKey, string> = {
  SYSTEM_ADMINISTRATOR: 'System Administrator',
  DISPENSING_PHARMACIST: 'Dispensing Pharmacist',
  SUPERINTENDENT_PHARMACIST: 'Superintendent Pharmacist',
  QPPV: 'QPPV (PV Contact)',
  QUALITY_ASSOCIATE: 'Quality Associate',
  QUALITY_MANAGER: 'Quality Manager',
  REGULATORY_AFFAIRS_OFFICER: 'Regulatory Affairs Officer',
  EXECUTIVE_READONLY: 'Executive (Read-only)',
}

/**
 * Resolves free-text role input to a canonical `TenantRoleKey`, accepting
 * either the raw key (`"QPPV"`, any case) or the human label
 * (`"QPPV (PV Contact)"`, any case) — so a bulk-import spreadsheet can use
 * whichever one the person preparing it actually knows. Returns `null`
 * for anything that matches neither, rather than guessing.
 */
export function resolveTenantRoleKey(input: string): TenantRoleKey | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const upper = trimmed.toUpperCase()
  if (isValidTenantRoleKey(upper)) return upper

  const lower = trimmed.toLowerCase()
  const byLabel = (Object.entries(TENANT_ROLE_LABELS) as [TenantRoleKey, string][]).find(
    ([, label]) => label.toLowerCase() === lower,
  )
  return byLabel ? byLabel[0] : null
}
