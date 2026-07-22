/**
 * VigiCloud Stage 16.2 — the PPB inspection-requirement catalog.
 * Originally 15 rows transcribed from `vigicloud docs/SafeMeds VigiCloud
 * Build Final. (1).pdf` §H2 (a CEO/field-expert-call tiering summary,
 * not a per-item guideline-cited source). Kenya PPB only, per the build
 * spec's own "configurable per NRA, Kenya PPB set built first" framing —
 * every other seeded authority gets no rows here yet, same content-gap
 * shape as `country-rules.seed-data.ts`'s own "only Kenya has real
 * rules" note.
 *
 * Real-usage content, 11 Sep 2026 — every row's `guidelineReference` now
 * cites `vigicloud document formats/PPV PV Inspections and checklist.docx`
 * ("PPB PV Inspection Checklist", §A Legal Framework & Local Oversight /
 * §B Case Management & Portal Metrics / §C Lifecycle Documentation &
 * Signal Tracking / §D Quality Systems & Third-Party Oversight) — the
 * actual document a real PPB inspector works from, not a planning
 * summary. This is the standard every document SafeMeds generates or
 * tracks readiness for is now checked against directly, per that
 * document's own explicit checklist structure — the four sections below
 * mirror it in order. Four genuinely new rows close gaps the real
 * checklist surfaces that the original 15 never covered at all
 * (`qppv_backup_continuity`, `case_quality_validity`,
 * `narrative_verbatim_preservation`, `rmp_alignment`); two stale
 * descriptions (PSUR/PBRER "not yet built", literature-monitoring's old
 * ~35-day window) are corrected to match what's actually shipped since
 * Stage 18/the 19 Aug real-usage pass.
 *
 * `source: 'system_generated'` rows are never backed by a stored
 * `AuditRequirementRecord` for their status — `AuditReadinessService`
 * resolves each one live from the real underlying data every time the
 * dashboard is read (see that service's own per-`requirementKey`
 * resolver map). `source: 'person_uploads'` rows are the ones a human
 * genuinely has to attest to/upload evidence for — those are backed by
 * `AuditRequirementRecord`.
 */

export type AuditRequirementSourceSeed = 'system_generated' | 'person_uploads'

export interface AuditRequirementDefinitionSeed {
  requirementKey: string
  sortOrder: number
  title: string
  description: string
  /**
   * Real-usage content, 11 Sep 2026 — populated from the real PPB PV
   * Inspection Checklist for every row that maps cleanly to one of its
   * own numbered items; left `undefined` (never written, so an admin's
   * own later edit via `/admin/audit-checklist` is never silently
   * overwritten by a reseed) for the handful of rows this specific
   * document doesn't name directly.
   */
  guidelineReference?: string
  source: AuditRequirementSourceSeed
  evidenceArtifactType: string
  isMandatory: boolean
}

export const AUDIT_REQUIREMENTS: AuditRequirementDefinitionSeed[] = [
  // ── §A — Legal Framework & Local Oversight ─────────────────────────
  {
    requirementKey: 'qppv_cv_qualifications',
    sortOrder: 1,
    title: 'QPPV CV, job description, qualifications',
    description: "Version-controlled upload, checked against GUD/006's own qualification list.",
    guidelineReference:
      'PPB PV Inspection Checklist §A.1 — QPPV Presence (a licensed, Kenya-resident QPPV physically available for interview)',
    source: 'person_uploads',
    evidenceArtifactType: 'Document (CV/job description/qualifications)',
    isMandatory: true,
  },
  {
    requirementKey: 'qppv_nomination',
    sortOrder: 2,
    title: 'QPPV nomination + regulator confirmation',
    description:
      "The system generates the nomination letter (Stage 16.4); the QPPV's regulator confirmation is uploaded manually and is what actually makes this row ready.",
    guidelineReference:
      'PPB PV Inspection Checklist §A.2 — Nomination Compliance (current QPPV nomination fully processed and approved on the PPB PvERS Portal)',
    source: 'system_generated',
    evidenceArtifactType: 'QppvNomination (letter + regulator confirmation document)',
    isMandatory: true,
  },
  {
    requirementKey: 'psmf_in_place',
    sortOrder: 3,
    title: 'PSMF in place and in use',
    description: 'Pulled live from Stage 16.1 — an active PSMF version exists for this company.',
    guidelineReference:
      'PPB PV Inspection Checklist §A.3 — PSMF Status (a complete, localized PSMF, active, up-to-date, and readily accessible)',
    source: 'system_generated',
    evidenceArtifactType: 'Psmf',
    isMandatory: true,
  },
  {
    requirementKey: 'qppv_backup_continuity',
    sortOrder: 4,
    title: 'Backup QPPV delegation log',
    description:
      "A documented delegation log proving a trained backup QPPV is genuinely available to cover the primary QPPV's absences — the nomination itself (Stage 16.4 already supports a distinct backup role) is necessary but not sufficient; an inspector asks to see the delegation record itself, not just that a name exists.",
    guidelineReference: 'PPB PV Inspection Checklist §A.4 — Business Continuity',
    source: 'person_uploads',
    evidenceArtifactType: 'Document (delegation log)',
    isMandatory: true,
  },
  {
    requirementKey: 'qppv_staff_training',
    sortOrder: 5,
    title: 'QPPV and staff training (GVP certificate / PPB academy)',
    description:
      'A non-expired training record for the current QPPV, with expiry tracking (Stage 16.6).',
    guidelineReference:
      "PPB PV Inspection Checklist §A — supports the QPPV competency this section as a whole is checking for (MedDRA/PvERS/inspection-technique modules, per the PSMF template's own §6.1)",
    source: 'system_generated',
    evidenceArtifactType: 'TrainingRecord',
    isMandatory: true,
  },

  // ── §B — Case Management & Portal Metrics ──────────────────────────
  {
    requirementKey: 'ae_log',
    sortOrder: 6,
    title: 'AE log',
    description:
      'Generated live from the case database at any time — always ready by definition, exportable as CSV.',
    guidelineReference:
      'PPB PV Inspection Checklist §B.1 — Source Intake Tracking (a clear, dated audit trail of how safety complaints move to the PV unit)',
    source: 'system_generated',
    evidenceArtifactType: 'Case (live export)',
    isMandatory: true,
  },
  {
    requirementKey: 'submission_evidence',
    sortOrder: 7,
    title: 'E2B / PSUR / PBRER / safety-notification submissions',
    description:
      "Pulled live from Stage 12's submission-evidence capture and Stage 18's periodic-report generation — ready the moment either a real E2B submission or a real PSUR/PBRER has been generated.",
    guidelineReference:
      'PPB PV Inspection Checklist §B.2 — PvERS Timelines (Serious ADRs sent within 15 calendar days) and §C.1 — PSUR Calendar (aggregate reports filed on time)',
    source: 'system_generated',
    evidenceArtifactType: 'RegulatorySubmission / GeneratedReport (PSUR/PBRER)',
    isMandatory: true,
  },
  {
    requirementKey: 'case_quality_validity',
    sortOrder: 8,
    title: 'Case quality — minimum criteria on every archived case',
    description:
      'The Validity Gate (Stage 4) enforces this structurally at case creation — no case can ever leave Intake without an identifiable patient, reporter, at least one suspect product, and at least one adverse event. This row confirms the gate has genuinely been exercised (real cases exist), not a second independent check of the same rule.',
    guidelineReference:
      'PPB PV Inspection Checklist §B.3 — Case Quality (archived cases consistently contain the 4 minimum criteria)',
    source: 'system_generated',
    evidenceArtifactType: 'Case (Validity Gate, Stage 4)',
    isMandatory: true,
  },
  {
    requirementKey: 'narrative_verbatim_preservation',
    sortOrder: 9,
    title: "Reporter's own original-language verbatim preserved",
    description:
      "⚠️ Known limitation, flagged rather than silently unenforced: this schema has no field yet for preserving a patient/reporter's own original-language verbatim narrative alongside its English translation (surfaced during the 19 Aug 2026 real-usage pass as a genuinely new, unbuilt capability). Until that exists, attest here that verbatim local-language phrasing is being preserved by process outside the system.",
    guidelineReference:
      'PPB PV Inspection Checklist §B.4 — Narrative Verbatim (localized patient descriptions, including Kiswahili phrases, left intact)',
    source: 'person_uploads',
    evidenceArtifactType: 'Document (process attestation)',
    isMandatory: false,
  },

  // ── §C — Lifecycle Documentation & Signal Tracking ─────────────────
  {
    requirementKey: 'rmp_alignment',
    sortOrder: 10,
    title: 'RMP risk-minimization alignment',
    description:
      "Pulled live from Stage 18 — an active Risk Management Plan exists for at least one product. Confirms a real, approved RMP exists to be audited against; doesn't (and can't yet) verify that its own risk-minimization measures are actually being carried out as described.",
    guidelineReference:
      'PPB PV Inspection Checklist §C.2 — RMP Alignment (local risk minimization measures implemented exactly as outlined in the approved RMP)',
    source: 'system_generated',
    evidenceArtifactType: 'RiskManagementPlan',
    isMandatory: true,
  },
  {
    requirementKey: 'literature_monitoring',
    sortOrder: 11,
    title: 'Literature-monitoring evidence',
    description:
      "Pulled live from Stage 19's literature-run log — ready if a screening run was logged within the last 7 days (the real, field-expert-confirmed weekly cadence — corrected from an earlier ~35-day placeholder during the 19 Aug 2026 real-usage pass), missing otherwise.",
    guidelineReference:
      'PPB PV Inspection Checklist §C.3 — Literature Monitoring Logs (weekly search of PubMed/AJOL, etc.)',
    source: 'system_generated',
    evidenceArtifactType: 'Literature-monitoring run log',
    isMandatory: true,
  },

  // ── §D — Quality Systems & Third-Party Oversight ───────────────────
  {
    requirementKey: 'personnel_training',
    sortOrder: 12,
    title: 'Personnel training evidence and materials',
    description:
      'Pulled live from Stage 16.6 — at least one non-expired training record exists company-wide.',
    guidelineReference:
      'PPB PV Inspection Checklist §D.1 — Staff Training Matrix (signed, dated certificates for all local staff, including commercial/marketing, annually)',
    source: 'system_generated',
    evidenceArtifactType: 'TrainingRecord',
    isMandatory: true,
  },
  {
    requirementKey: 'sdea_contracts',
    sortOrder: 13,
    title: 'Signed service contracts and SDEAs',
    description:
      'Pulled live from Stage 16.5 — every distributor relationship has an active, unexpired SDEA.',
    guidelineReference:
      'PPB PV Inspection Checklist §D.2 — Partner SDEAs (signed SDEAs with 24-48 hour case escalation clauses)',
    source: 'system_generated',
    evidenceArtifactType: 'Sdea',
    isMandatory: true,
  },
  {
    requirementKey: 'internal_audit_capa',
    sortOrder: 14,
    title: 'Internal-audit findings and CAPAs with effectiveness checks',
    description:
      'Pulled live from Stage 16.3 — no CAPA sitting open or awaiting its effectiveness check past its own due date.',
    guidelineReference:
      'PPB PV Inspection Checklist §D.3 — Internal Quality Loop (regular Internal PV Audits alongside an updated, open CAPA tracker)',
    source: 'system_generated',
    evidenceArtifactType: 'Capa',
    isMandatory: true,
  },
  {
    requirementKey: 'qms_nine_elements',
    sortOrder: 15,
    title: 'QMS nine elements, including supplier qualification',
    description: 'A repository plus a nine-element checklist, evidence uploaded per element.',
    guidelineReference:
      "PPB PV Inspection Checklist §D — supports this section's own Quality Systems framing at large, not one specific numbered item",
    source: 'person_uploads',
    evidenceArtifactType: 'Document + checklist',
    isMandatory: true,
  },

  // ── Not named directly in the PPB PV Inspection Checklist, kept from the original 15 ──
  {
    requirementKey: 'archiving_retention',
    sortOrder: 16,
    title: 'Archiving, retention, readable retrieval',
    description:
      'A structural guarantee of the platform itself (never-delete/deactivate-only convention, append-only audit trail) — not a per-company configuration, so always ready.',
    source: 'system_generated',
    evidenceArtifactType: 'Base-engine retention policy (Stage 0.9)',
    isMandatory: true,
  },
  {
    requirementKey: 'availability_evidence',
    sortOrder: 17,
    title: '24/7 availability evidence',
    description:
      'Pulled live from Stage 15.2 — a successfully reached contact test logged outside normal business hours.',
    source: 'system_generated',
    evidenceArtifactType: 'ContactTest',
    isMandatory: true,
  },
  {
    requirementKey: 'annual_reconciliation',
    sortOrder: 18,
    title: 'Annual reconciliation and results',
    description:
      'Pulled live from Stage 15.1 — a reconciliation report generated within the last 12 months.',
    source: 'system_generated',
    evidenceArtifactType: 'ReconciliationReport',
    isMandatory: true,
  },
  {
    requirementKey: 'pv_studies',
    sortOrder: 19,
    title: 'PV studies with approvals',
    description:
      'A repository with approval status, uploaded per study — not every tenant runs PV studies, so this row is not mandatory.',
    source: 'person_uploads',
    evidenceArtifactType: 'Document + approval status',
    isMandatory: false,
  },
]
