/**
 * Shared "was this outside normal business hours" check — extracted from
 * `AuditReadinessService`'s own inline `availability_evidence` resolver
 * logic (Stage 16.2) so VigiCloud Stage 21's real after-hours call/
 * voicemail logging can use the exact same definition, not a
 * second, potentially-drifting copy. Normal business hours are
 * 08:00–18:00 UTC, Monday–Friday — deliberately UTC-fixed rather than a
 * per-tenant timezone setting, matching this schema's existing
 * "timestamptz everywhere, UTC is the one true clock" convention.
 */
export function isAfterHoursOrWeekend(occurredAt: Date): boolean {
  const hour = occurredAt.getUTCHours()
  const day = occurredAt.getUTCDay()
  return hour < 8 || hour >= 18 || day === 0 || day === 6
}
