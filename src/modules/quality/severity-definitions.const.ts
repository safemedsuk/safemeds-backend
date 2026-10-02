/**
 * QualCloud (Phase 13) Stage 0.3 — the shared Critical/Major/Minor
 * severity taxonomy `todo-qualcloud.md` names as a 🧭 domain default
 * (WHO GMP's own commonly-used three-tier scheme), shared across
 * deviation/OOS/complaint/audit-finding classification once those
 * stages ship. Read-only for now, deliberately: a real, versioned,
 * admin-editable-through-the-Admin-Configuration-Console rewrite of
 * this text (mirroring `AuditRequirementDefinition`'s own precedent) is
 * left as explicitly deferred, honestly-flagged work — see
 * `needs.md`/the Stage 0 completion write-up — rather than shipping a
 * half-built version-on-write editor for three lines of text in this
 * same pass. Exposed via `GET /quality/severity-definitions` so the
 * frontend never has to hardcode this text a second time.
 */
export interface SeverityDefinition {
  key: 'critical' | 'major' | 'minor'
  label: string
  description: string
}

export const SEVERITY_DEFINITIONS: SeverityDefinition[] = [
  {
    key: 'critical',
    label: 'Critical',
    description:
      'Actual or potential direct impact on patient safety, product efficacy, or data integrity ' +
      '(e.g. a sterility failure, a wrong-label mix-up, a fabricated record).',
  },
  {
    key: 'major',
    label: 'Major',
    description:
      'A significant deviation from an approved procedure/specification with no direct immediate ' +
      'patient-safety impact but real risk to product quality if unaddressed (e.g. a temperature ' +
      "excursion within a batch's hold-time, an uncalibrated-but-in-tolerance instrument used).",
  },
  {
    key: 'minor',
    label: 'Minor',
    description:
      'A deviation from procedure with no quality/safety impact (e.g. a documentation error caught ' +
      'and corrected same-day).',
  },
]
