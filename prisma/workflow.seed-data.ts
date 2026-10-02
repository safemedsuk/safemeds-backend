/**
 * The default PV case workflow (v1) — Phase 5.1's seeded lifecycle, per the
 * build spec: Intake → Triage → Medical Review → Coding → Narrative →
 * Quality Check → Submission Ready → Submitted, with the QPPV approval
 * transition (Quality Check → Submission Ready) signature-gated.
 *
 * Role gates below are a deliberate, documented judgment call — the build
 * spec only pins the *shape* of the lifecycle and that "the QPPV approval
 * transition" requires a signature; it doesn't pin every intermediate
 * role. Mapped from `docs/safemeds-user-types.md`'s tenant-role remit:
 * Superintendent Pharmacist owns Triage; QPPV owns Medical Review, MedDRA
 * coding, and narrative drafting (the taxonomy has no separate "medical
 * writer" role) and is the one who signs ICSR submissions; Quality
 * Associate performs the pre-submission quality check; Regulatory Affairs
 * Officer dispatches the final submission. Revisit this mapping once
 * VigiCloud (Phase 11) defines real case-review staffing.
 *
 * `closed_archived` (added 11 Sep 2026, "SafeMeds VigiCloud Workflow Map")
 * is the master lifecycle's real 9th stage — "Lock, e-sign, archive; feed
 * signals and trends," owner QPPV. `submitted` is no longer terminal as a
 * result; this is a pure *extension* (a new terminal state added past the
 * previous one), not a reorder, so `seedWorkflowDefinition()`'s
 * re-point-don't-delete safeguard (see CLAUDE.md's own gotchas entry)
 * applies cleanly to every real case already sitting at `submitted`. The
 * map's other three named phases (Validity Gate, Expectedness, Follow-up)
 * are deliberately *not* modeled as their own states here — they're real,
 * already-built cross-cutting mechanisms (`ValidityGateService`,
 * `ExpectednessService`, `CaseFollowUpService`) that don't sit at one
 * single point in the linear chain the way the map's own diagram
 * suggests (Follow-up in particular can legitimately re-trigger from
 * several later states, not just one) — surfaced as their own named
 * sections/badges on the case detail page instead of forcing a false
 * one-node-per-phase fit. See `case-stage-tracker.tsx` for how the
 * frontend reconciles this.
 */

export const PV_CASE_WORKFLOW_RECORD_TYPE = 'pv_case'

export const PV_CASE_WORKFLOW_STATES = [
  { key: 'intake', name: 'Intake', isInitial: true, isTerminal: false },
  { key: 'triage', name: 'Triage & Seriousness', isInitial: false, isTerminal: false },
  {
    key: 'medical_review',
    name: 'Causality & Medical Review',
    isInitial: false,
    isTerminal: false,
  },
  { key: 'coding', name: 'Code & Enter', isInitial: false, isTerminal: false },
  { key: 'narrative', name: 'Narrative', isInitial: false, isTerminal: false },
  { key: 'quality_check', name: 'Quality Check', isInitial: false, isTerminal: false },
  { key: 'submission_ready', name: 'Submission Ready', isInitial: false, isTerminal: false },
  { key: 'submitted', name: 'Submit (E2B)', isInitial: false, isTerminal: false },
  { key: 'closed_archived', name: 'Close & Archive', isInitial: false, isTerminal: true },
] as const

export const PV_CASE_WORKFLOW_TRANSITIONS: {
  from: string
  to: string
  requiredRoleKey: string
  requiresSignature: boolean
}[] = [
  {
    from: 'intake',
    to: 'triage',
    requiredRoleKey: 'SUPERINTENDENT_PHARMACIST',
    requiresSignature: false,
  },
  { from: 'triage', to: 'medical_review', requiredRoleKey: 'QPPV', requiresSignature: false },
  { from: 'medical_review', to: 'coding', requiredRoleKey: 'QPPV', requiresSignature: false },
  { from: 'coding', to: 'narrative', requiredRoleKey: 'QPPV', requiresSignature: false },
  {
    from: 'narrative',
    to: 'quality_check',
    requiredRoleKey: 'QUALITY_ASSOCIATE',
    requiresSignature: false,
  },
  // Stage 9 — the QC reviewer's "send it back" path, same role as the
  // approval it's an alternative to. Deliberately *not* four-eyes-guarded
  // (see `PvWorkflowGuards`'s own comment): rejecting your own case for
  // more work isn't the self-certification risk approving it forward is.
  {
    from: 'narrative',
    to: 'medical_review',
    requiredRoleKey: 'QUALITY_ASSOCIATE',
    requiresSignature: false,
  },
  {
    from: 'quality_check',
    to: 'submission_ready',
    requiredRoleKey: 'QPPV',
    requiresSignature: true,
  },
  {
    from: 'submission_ready',
    to: 'submitted',
    requiredRoleKey: 'REGULATORY_AFFAIRS_OFFICER',
    requiresSignature: false,
  },
  // Workflow-map stage 9 — "Lock, e-sign, archive; feed signals and
  // trends," owner QPPV. Signature-gated like the QC→Submission-Ready
  // approval above; also guarded (see `PvWorkflowGuards`) against closing
  // a case with a still-open follow-up cycle or an unresolved duplicate
  // review — the map's own "cannot close with open obligations" rule.
  { from: 'submitted', to: 'closed_archived', requiredRoleKey: 'QPPV', requiresSignature: true },
]

/**
 * VigiCloud Stage 17 — the signal-management lifecycle, GVP Module IX
 * §IX.A.1.1's six named activities (Reconciliation Note 7): detection →
 * validation → confirmation → analysis and prioritisation → assessment →
 * recommendation for action. Modeled as a real branching workflow (unlike
 * `pv_case`'s linear chain) — validation and confirmation each have a
 * genuine reject path (`non_validated`/`not_confirmed`, both terminal),
 * and the final assessment step branches into `action_recommended` or
 * `refuted`. QPPV holds every transition's required role — signal
 * judgment calls are medical/regulatory calls, the same remit QPPV
 * already owns for medical review and ICSR sign-off. Only the final
 * "recommend action" transition is signature-gated, matching
 * `pv.sign_icsr`'s own precedent of gating the one transition that's a
 * real formal regulatory decision — `refuted` deliberately isn't
 * signature-gated, per the same "rejecting isn't the self-certification
 * risk approving is" reasoning `pv_case`'s own reject path uses.
 */
export const SIGNAL_WORKFLOW_RECORD_TYPE = 'signal'

export const SIGNAL_WORKFLOW_STATES = [
  { key: 'detected', name: 'Detected', isInitial: true, isTerminal: false },
  { key: 'validated', name: 'Validated', isInitial: false, isTerminal: false },
  { key: 'non_validated', name: 'Not Validated', isInitial: false, isTerminal: true },
  { key: 'confirmed', name: 'Confirmed', isInitial: false, isTerminal: false },
  { key: 'not_confirmed', name: 'Not Confirmed', isInitial: false, isTerminal: true },
  {
    key: 'analysed_prioritised',
    name: 'Analysed & Prioritised',
    isInitial: false,
    isTerminal: false,
  },
  { key: 'assessed', name: 'Assessed', isInitial: false, isTerminal: false },
  { key: 'action_recommended', name: 'Action Recommended', isInitial: false, isTerminal: true },
  { key: 'refuted', name: 'Refuted', isInitial: false, isTerminal: true },
] as const

export const SIGNAL_WORKFLOW_TRANSITIONS: {
  from: string
  to: string
  requiredRoleKey: string
  requiresSignature: boolean
}[] = [
  { from: 'detected', to: 'validated', requiredRoleKey: 'QPPV', requiresSignature: false },
  { from: 'detected', to: 'non_validated', requiredRoleKey: 'QPPV', requiresSignature: false },
  { from: 'validated', to: 'confirmed', requiredRoleKey: 'QPPV', requiresSignature: false },
  { from: 'validated', to: 'not_confirmed', requiredRoleKey: 'QPPV', requiresSignature: false },
  {
    from: 'confirmed',
    to: 'analysed_prioritised',
    requiredRoleKey: 'QPPV',
    requiresSignature: false,
  },
  {
    from: 'analysed_prioritised',
    to: 'assessed',
    requiredRoleKey: 'QPPV',
    requiresSignature: false,
  },
  { from: 'assessed', to: 'action_recommended', requiredRoleKey: 'QPPV', requiresSignature: true },
  { from: 'assessed', to: 'refuted', requiredRoleKey: 'QPPV', requiresSignature: false },
]

/**
 * RegCloud (Phase 12) Stages 1–7 — the master registration lifecycle's
 * own workflow, now built out in full: Classify & Plan (`planning`),
 * Compile Dossier (`compiling`), the flagship Completeness & Format
 * Check gate (`completeness_check`), Submit (`submitted`), Query &
 * Assessment (`query_received`/`responding`/`resubmitted_for_review` —
 * a real branch/loop, not a straight line: `resubmitted_for_review` can
 * go either to a second round of `query_received` or on to a decision),
 * and Approval/Registration (`approved`/`rejected`, both terminal).
 * `REGULATORY_AFFAIRS_OFFICER` holds every transition's required role —
 * the only tenant role with dossier-management remit today (see
 * `todo-regcloud.md`'s own Stage 0.6 RBAC note); revisit only if a real
 * discovery answer says a distinct role should own compilation vs.
 * planning vs. the final approval decision.
 *
 * `approved` is signature-gated (a real, formal regulatory decision,
 * matching `pv_case`'s own `quality_check → submission_ready` precedent)
 * — `rejected` deliberately isn't, per this project's own established
 * "rejecting isn't the self-certification risk approving is" reasoning.
 * Reused unchanged by Stage 7's variations/renewals: a `RegVariation`'s
 * own dossier runs through this exact same definition (see that model's
 * own doc comment) rather than a second, parallel workflow.
 */
export const REG_REGISTRATION_WORKFLOW_RECORD_TYPE = 'reg_registration'

export const REG_REGISTRATION_WORKFLOW_STATES = [
  { key: 'planning', name: 'Planning', isInitial: true, isTerminal: false },
  { key: 'compiling', name: 'Compiling Dossier', isInitial: false, isTerminal: false },
  { key: 'completeness_check', name: 'Completeness Check', isInitial: false, isTerminal: false },
  /**
   * testing-correction-explanation.md §2.2 — a non-renewal variation's own
   * entry point, never reachable via a normal role-gated transition (no
   * `to: 'variation_application'` transition is seeded below) — only
   * `RegVariationService.create()`'s own system-owned fast-forward, right
   * after instantiation, ever puts a dossier here. `isInitial: false`
   * deliberately: this workflow's one seeded initial state stays
   * `planning`, matching every other dossier kind this same definition
   * serves (fresh registration, CTA, reliance).
   */
  {
    key: 'variation_application',
    name: 'Variation Application',
    isInitial: false,
    isTerminal: false,
  },
  /** testing-correction-explanation.md §3.1 — a renewal's own entry point, same "system fast-forward only" rule as `variation_application` above. */
  { key: 'renewal_requested', name: 'Renewal Requested', isInitial: false, isTerminal: false },
  { key: 'submitted', name: 'Submitted', isInitial: false, isTerminal: false },
  { key: 'query_received', name: 'Query Received', isInitial: false, isTerminal: false },
  { key: 'responding', name: 'Responding', isInitial: false, isTerminal: false },
  {
    key: 'resubmitted_for_review',
    name: 'Resubmitted for Review',
    isInitial: false,
    isTerminal: false,
  },
  { key: 'approved', name: 'Approved', isInitial: false, isTerminal: true },
  { key: 'rejected', name: 'Rejected', isInitial: false, isTerminal: true },
] as const

export const REG_REGISTRATION_WORKFLOW_TRANSITIONS: {
  from: string
  to: string
  requiredRoleKey: string
  requiresSignature: boolean
}[] = [
  {
    from: 'planning',
    to: 'compiling',
    requiredRoleKey: 'REGULATORY_AFFAIRS_OFFICER',
    requiresSignature: false,
  },
  // The flagship gate — `RegWorkflowGuards` blocks this transition until
  // `CompletenessGateService` reports every mandatory checklist slot filled.
  {
    from: 'compiling',
    to: 'completeness_check',
    requiredRoleKey: 'REGULATORY_AFFAIRS_OFFICER',
    requiresSignature: false,
  },
  // Stage 4 — blocked until a `RegSubmission` has real dispatch evidence attached.
  {
    from: 'completeness_check',
    to: 'submitted',
    requiredRoleKey: 'REGULATORY_AFFAIRS_OFFICER',
    requiresSignature: false,
  },
  // testing-correction-explanation.md §2.2 — blocked until the 3 documents
  // required at Variation Application (proof of payment, PPB invoice,
  // ≥1 accompanying-change document) are all present.
  {
    from: 'variation_application',
    to: 'submitted',
    requiredRoleKey: 'REGULATORY_AFFAIRS_OFFICER',
    requiresSignature: false,
  },
  // testing-correction-explanation.md §3.1 — reuses the exact same
  // dispatch-evidence gate `completeness_check → submitted` already has;
  // a renewal never sees a document checklist gate, just Generate
  // Submission + Attach Evidence, same as every other dossier from here on.
  {
    from: 'renewal_requested',
    to: 'submitted',
    requiredRoleKey: 'REGULATORY_AFFAIRS_OFFICER',
    requiresSignature: false,
  },
  // Stage 5 — the regulator comes back with questions; both entry points
  // into a query round (fresh, or a second round after resubmission)
  // require `payload.queryText` (a guard-enforced precondition, not a
  // sync-function default).
  {
    from: 'submitted',
    to: 'query_received',
    requiredRoleKey: 'REGULATORY_AFFAIRS_OFFICER',
    requiresSignature: false,
  },
  {
    from: 'resubmitted_for_review',
    to: 'query_received',
    requiredRoleKey: 'REGULATORY_AFFAIRS_OFFICER',
    requiresSignature: false,
  },
  {
    from: 'query_received',
    to: 'responding',
    requiredRoleKey: 'REGULATORY_AFFAIRS_OFFICER',
    requiresSignature: false,
  },
  // Blocked until the open `RegQuery` actually has a response attached.
  {
    from: 'responding',
    to: 'resubmitted_for_review',
    requiredRoleKey: 'REGULATORY_AFFAIRS_OFFICER',
    requiresSignature: false,
  },
  // Stage 6 — the two real decision points, reachable either straight
  // from Submitted (no query round needed) or after a full query cycle.
  {
    from: 'submitted',
    to: 'approved',
    requiredRoleKey: 'REGULATORY_AFFAIRS_OFFICER',
    requiresSignature: true,
  },
  {
    from: 'submitted',
    to: 'rejected',
    requiredRoleKey: 'REGULATORY_AFFAIRS_OFFICER',
    requiresSignature: false,
  },
  {
    from: 'resubmitted_for_review',
    to: 'approved',
    requiredRoleKey: 'REGULATORY_AFFAIRS_OFFICER',
    requiresSignature: true,
  },
  {
    from: 'resubmitted_for_review',
    to: 'rejected',
    requiredRoleKey: 'REGULATORY_AFFAIRS_OFFICER',
    requiresSignature: false,
  },
]

/**
 * RegCloud (Phase 12) Stage 13 — Advertising & Promotion. Deliberately
 * the smallest real workflow in this file: no query/response loop (see
 * `PromotionalMaterialWorkflowGuards`'s own doc comment for why this is
 * a considered scope decision, not an oversight) — a lighter-weight
 * submission-and-decision cycle appropriate to reviewing one piece of
 * promotional material, not a multi-document regulatory dossier.
 */
export const PROMOTIONAL_MATERIAL_WORKFLOW_RECORD_TYPE = 'promotional_material'

export const PROMOTIONAL_MATERIAL_WORKFLOW_STATES = [
  { key: 'draft', name: 'Draft', isInitial: true, isTerminal: false },
  { key: 'submitted', name: 'Submitted', isInitial: false, isTerminal: false },
  { key: 'approved', name: 'Approved', isInitial: false, isTerminal: true },
  { key: 'rejected', name: 'Rejected', isInitial: false, isTerminal: true },
] as const

export const PROMOTIONAL_MATERIAL_WORKFLOW_TRANSITIONS: {
  from: string
  to: string
  requiredRoleKey: string
  requiresSignature: boolean
}[] = [
  // Blocked until the material itself has been uploaded — see
  // `PromotionalMaterialWorkflowGuards`.
  {
    from: 'draft',
    to: 'submitted',
    requiredRoleKey: 'REGULATORY_AFFAIRS_OFFICER',
    requiresSignature: false,
  },
  {
    from: 'submitted',
    to: 'approved',
    requiredRoleKey: 'REGULATORY_AFFAIRS_OFFICER',
    requiresSignature: true,
  },
  {
    from: 'submitted',
    to: 'rejected',
    requiredRoleKey: 'REGULATORY_AFFAIRS_OFFICER',
    requiresSignature: false,
  },
]

/**
 * RegCloud (Phase 12) Stage 14 — Post-Market & Recall. The literal
 * linear sequence the build spec's own Stage 14 bullet names — no
 * shortcut transitions added speculatively (e.g. a direct
 * `reported → closed` for a false alarm) since the sourced material
 * only ever describes this one path; extend later if a real discovery
 * answer confirms a shortcut is needed.
 */
export const RECALL_WORKFLOW_RECORD_TYPE = 'recall'

/**
 * QualCloud (Phase 13) Stage 10.2 — the real 8-state lifecycle per the
 * Product Build Package's own case-lifecycle diagram, superseding the
 * original 5-state `reported → investigating → notified_to_authority →
 * in_progress → closed` sequence above (kept as a comment for history,
 * not as a second definition) — `seedWorkflowDefinition()`'s own
 * re-point-don't-delete safeguard only ever re-points an instance onto
 * a new state sharing the exact same `stateKey` (it does no semantic
 * remapping) — verified against the real dev database before this
 * migration: the one real pre-existing `Recall` workflow instance was
 * already sitting in `closed`, which exists unchanged in both the old
 * and new definitions, so it's preserved automatically. Had any real
 * instance existed in one of the four states this rewrite removes
 * (`reported`/`investigating`/`notified_to_authority`/`in_progress`),
 * the safeguard's own loud `console.warn` would have named it rather
 * than silently dropping it.
 */
export const RECALL_WORKFLOW_STATES = [
  { key: 'draft', name: 'Draft', isInitial: true, isTerminal: false },
  { key: 'under_assessment', name: 'Under Assessment', isInitial: false, isTerminal: false },
  { key: 'approved', name: 'Approved', isInitial: false, isTerminal: false },
  { key: 'notification', name: 'Notification', isInitial: false, isTerminal: false },
  { key: 'execution', name: 'Execution', isInitial: false, isTerminal: false },
  { key: 'reconciliation', name: 'Reconciliation', isInitial: false, isTerminal: false },
  { key: 'closure_pending', name: 'Closure Pending', isInitial: false, isTerminal: false },
  { key: 'closed', name: 'Closed', isInitial: false, isTerminal: true },
  { key: 'cancelled', name: 'Cancelled', isInitial: false, isTerminal: true },
] as const

export const RECALL_WORKFLOW_TRANSITIONS: {
  from: string
  to: string
  requiredRoleKey: string
  requiresSignature: boolean
}[] = [
  { from: 'draft', to: 'under_assessment', requiredRoleKey: 'QUALITY_ASSOCIATE', requiresSignature: false },
  { from: 'draft', to: 'cancelled', requiredRoleKey: 'QUALITY_ASSOCIATE', requiresSignature: false },
  { from: 'under_assessment', to: 'cancelled', requiredRoleKey: 'QUALITY_ASSOCIATE', requiresSignature: false },
  // The real recall decision — a genuine compliance/business decision — is e-signature-gated, matching `RISK.APPROVE`/`RECALL.APPROVE` → QUALITY_MANAGER (10.8).
  { from: 'under_assessment', to: 'approved', requiredRoleKey: 'QUALITY_MANAGER', requiresSignature: true },
  { from: 'approved', to: 'notification', requiredRoleKey: 'QUALITY_ASSOCIATE', requiresSignature: false },
  { from: 'notification', to: 'execution', requiredRoleKey: 'QUALITY_ASSOCIATE', requiresSignature: false },
  { from: 'execution', to: 'reconciliation', requiredRoleKey: 'QUALITY_ASSOCIATE', requiresSignature: false },
  { from: 'reconciliation', to: 'closure_pending', requiredRoleKey: 'QUALITY_ASSOCIATE', requiresSignature: false },
  // A failed gate or a regulator returning a report sends it back, not forward.
  { from: 'closure_pending', to: 'execution', requiredRoleKey: 'QUALITY_ASSOCIATE', requiresSignature: false },
  // Full closure — the real 8-gate check (Stage 10.6) is a later stage;
  // this transition is deliberately still signature-gated as the real
  // compliance terminal action, matching this project's own "the
  // significant terminal action gets a signature" precedent, with the
  // full gate-by-gate enforcement left for that future pass.
  { from: 'closure_pending', to: 'closed', requiredRoleKey: 'QUALITY_MANAGER', requiresSignature: true },
]

/**
 * Real-usage request, 11 Sep 2026 — "Periodic and aggregate reports...
 * as proper workflows (data-lock point, generate, review, QPPV sign-off,
 * submit, evidence)". `PeriodicReportService.generate()` already does
 * "define period" (the EURD/DLP cadence engine) and "assemble from
 * database" (`BenefitRiskService`) and "author" (the PDF) as one atomic
 * call, landing at `draft` — this workflow picks up from there for the
 * two real human steps the map's own pipeline names: "review" (QC) and
 * "QPPV sign-off" + "submit" (collapsed into one signature-gated
 * transition, matching `pv_case`'s own identical precedent —
 * `quality_check → submission_ready` is likewise "the QPPV approval
 * transition," one real action for both concepts). "Evidence" and
 * "Track" are deliberately not further states — evidence is an
 * ungated, post-submission "attach proof" action
 * (`PeriodicReportService.attachEvidence()`, `GeneratedReport.
 * evidenceDocumentId`), since a periodic report is dispatched manually
 * (portal upload, email) with no live gateway to gate on the way
 * `RegulatorySubmissionWorkflowGuards` gates E2B evidence — and "Track"
 * is just viewing this same, already-audited state over time, not a
 * new one.
 */
export const PERIODIC_REPORT_WORKFLOW_RECORD_TYPE = 'periodic_report'

export const PERIODIC_REPORT_WORKFLOW_STATES = [
  { key: 'draft', name: 'Draft', isInitial: true, isTerminal: false },
  { key: 'qc_reviewed', name: 'QC Reviewed', isInitial: false, isTerminal: false },
  { key: 'submitted', name: 'Submitted', isInitial: false, isTerminal: true },
] as const

export const PERIODIC_REPORT_WORKFLOW_TRANSITIONS: {
  from: string
  to: string
  requiredRoleKey: string
  requiresSignature: boolean
}[] = [
  {
    from: 'draft',
    to: 'qc_reviewed',
    requiredRoleKey: 'QUALITY_ASSOCIATE',
    requiresSignature: false,
  },
  { from: 'qc_reviewed', to: 'submitted', requiredRoleKey: 'QPPV', requiresSignature: true },
]

/**
 * QualCloud (Phase 13) Stage 1 — Document Control. The real
 * Draft→Review&Approve→Effective→(Superseded|Retired) lifecycle
 * `Sop.status`'s own schema doc comment (Stage 0) already named and
 * explicitly deferred to this stage. `QUALITY_ASSOCIATE` drafts and
 * submits; `QUALITY_MANAGER` is the independent second approver —
 * never the same person who authored the document, matching this
 * project's own established "the author cannot also be the sole
 * approver" GMP control (enforced by `QualityWorkflowGuards`, not by
 * this seed data). Signature-gated only on `approved` — the one real
 * GMP approval-signature moment; `effective`/`retired` are plain
 * role-gated transitions (the e-signature already happened at
 * approval, re-signing to merely *activate* an already-approved
 * document adds no real control). Read & Understand is deliberately
 * NOT a workflow state (see the guard file's own doc comment for why
 * a document going effective must never wait on being read) — it is
 * a separate `DocumentAcknowledgment` tracking mechanism layered on
 * top of the `effective` state.
 */
export const QUALITY_CONTROLLED_DOCUMENT_WORKFLOW_RECORD_TYPE = 'quality_controlled_document'

export const QUALITY_CONTROLLED_DOCUMENT_WORKFLOW_STATES = [
  { key: 'draft', name: 'Draft', isInitial: true, isTerminal: false },
  { key: 'in_review', name: 'In Review', isInitial: false, isTerminal: false },
  { key: 'approved', name: 'Approved', isInitial: false, isTerminal: false },
  { key: 'effective', name: 'Effective', isInitial: false, isTerminal: false },
  { key: 'superseded', name: 'Superseded', isInitial: false, isTerminal: true },
  { key: 'retired', name: 'Retired', isInitial: false, isTerminal: true },
] as const

export const QUALITY_CONTROLLED_DOCUMENT_WORKFLOW_TRANSITIONS: {
  from: string
  to: string
  requiredRoleKey: string
  requiresSignature: boolean
}[] = [
  {
    from: 'draft',
    to: 'in_review',
    requiredRoleKey: 'QUALITY_ASSOCIATE',
    requiresSignature: false,
  },
  // Reject — back to draft for rework, no signature (rejecting isn't the
  // self-certification risk approving is, same precedent this project
  // already established for PV case Narrative→Medical Review).
  {
    from: 'in_review',
    to: 'draft',
    requiredRoleKey: 'QUALITY_MANAGER',
    requiresSignature: false,
  },
  {
    from: 'in_review',
    to: 'approved',
    requiredRoleKey: 'QUALITY_MANAGER',
    requiresSignature: true,
  },
  {
    from: 'approved',
    to: 'effective',
    requiredRoleKey: 'QUALITY_MANAGER',
    requiresSignature: false,
  },
  {
    from: 'effective',
    to: 'retired',
    requiredRoleKey: 'QUALITY_MANAGER',
    requiresSignature: false,
  },
]

/**
 * QualCloud (Phase 13) Stage 2 — Deviation & Non-Conformance
 * Management. Master lifecycle stages 1–3 (Detect/Raise → Assess &
 * Classify → Investigate/Root Cause), specialized for a deviation.
 * `capa_pending → closed` is guarded (`QualityWorkflowGuards`) —
 * cannot close until a linked `Capa` exists and has reached an
 * effective/closed state, mirroring VigiCloud's own "cannot close
 * with open obligations" precedent exactly.
 */
export const QUALITY_DEVIATION_WORKFLOW_RECORD_TYPE = 'quality_deviation'

export const QUALITY_DEVIATION_WORKFLOW_STATES = [
  { key: 'detected', name: 'Detected', isInitial: true, isTerminal: false },
  { key: 'classifying', name: 'Classifying', isInitial: false, isTerminal: false },
  { key: 'investigating', name: 'Investigating', isInitial: false, isTerminal: false },
  { key: 'capa_pending', name: 'CAPA Pending', isInitial: false, isTerminal: false },
  { key: 'closed', name: 'Closed', isInitial: false, isTerminal: true },
] as const

export const QUALITY_DEVIATION_WORKFLOW_TRANSITIONS: {
  from: string
  to: string
  requiredRoleKey: string
  requiresSignature: boolean
}[] = [
  {
    from: 'detected',
    to: 'classifying',
    requiredRoleKey: 'QUALITY_ASSOCIATE',
    requiresSignature: false,
  },
  {
    from: 'classifying',
    to: 'investigating',
    requiredRoleKey: 'QUALITY_ASSOCIATE',
    requiresSignature: false,
  },
  {
    from: 'investigating',
    to: 'capa_pending',
    requiredRoleKey: 'QUALITY_MANAGER',
    requiresSignature: false,
  },
  // Closing a deviation is the real compliance sign-off — signature-gated,
  // matching CAPA closure's own established precedent.
  {
    from: 'capa_pending',
    to: 'closed',
    requiredRoleKey: 'QUALITY_MANAGER',
    requiresSignature: true,
  },
]

// ── QualCloud (Phase 13) Stage 4 — Change Control ───────────────────────

export const QUALITY_CHANGE_CONTROL_WORKFLOW_RECORD_TYPE = 'quality_change_control'

export const QUALITY_CHANGE_CONTROL_WORKFLOW_STATES = [
  { key: 'proposed', name: 'Proposed', isInitial: true, isTerminal: false },
  { key: 'impact_assessment', name: 'Impact Assessment', isInitial: false, isTerminal: false },
  { key: 'approved', name: 'Approved', isInitial: false, isTerminal: false },
  { key: 'implementing', name: 'Implementing', isInitial: false, isTerminal: false },
  { key: 'verifying', name: 'Verifying', isInitial: false, isTerminal: false },
  { key: 'closed', name: 'Closed', isInitial: false, isTerminal: true },
] as const

export const QUALITY_CHANGE_CONTROL_WORKFLOW_TRANSITIONS: {
  from: string
  to: string
  requiredRoleKey: string
  requiresSignature: boolean
}[] = [
  {
    from: 'proposed',
    to: 'impact_assessment',
    requiredRoleKey: 'QUALITY_ASSOCIATE',
    requiresSignature: false,
  },
  // The real cross-functional sign-off — signature-gated, and guarded
  // (`QualityWorkflowGuards`) to require every flagged approver role has
  // already recorded its approval via `recordApproval()`.
  {
    from: 'impact_assessment',
    to: 'approved',
    requiredRoleKey: 'QUALITY_MANAGER',
    requiresSignature: true,
  },
  {
    from: 'approved',
    to: 'implementing',
    requiredRoleKey: 'QUALITY_ASSOCIATE',
    requiresSignature: false,
  },
  {
    from: 'implementing',
    to: 'verifying',
    requiredRoleKey: 'QUALITY_ASSOCIATE',
    requiresSignature: false,
  },
  // Cannot close until verification confirms no adverse effect — guarded.
  {
    from: 'verifying',
    to: 'closed',
    requiredRoleKey: 'QUALITY_MANAGER',
    requiresSignature: true,
  },
]

// ── QualCloud (Phase 13) Stage 5 — Complaint Handling ───────────────────

export const QUALITY_COMPLAINT_WORKFLOW_RECORD_TYPE = 'quality_complaint'

export const QUALITY_COMPLAINT_WORKFLOW_STATES = [
  { key: 'intake', name: 'Intake', isInitial: true, isTerminal: false },
  { key: 'classifying', name: 'Classifying', isInitial: false, isTerminal: false },
  { key: 'investigating', name: 'Investigating', isInitial: false, isTerminal: false },
  { key: 'resolved', name: 'Resolved', isInitial: false, isTerminal: true },
] as const

export const QUALITY_COMPLAINT_WORKFLOW_TRANSITIONS: {
  from: string
  to: string
  requiredRoleKey: string
  requiresSignature: boolean
}[] = [
  {
    from: 'intake',
    to: 'classifying',
    requiredRoleKey: 'QUALITY_ASSOCIATE',
    requiresSignature: false,
  },
  {
    from: 'classifying',
    to: 'investigating',
    requiredRoleKey: 'QUALITY_ASSOCIATE',
    requiresSignature: false,
  },
  // Not signature-gated — deliberately lighter-weight than closing a
  // Deviation/CAPA, matching this stage's own "not every complaint needs
  // a CAPA" reasoning; the resolution-time KPI is meant to be a real,
  // frequently-hit metric, not a heavy compliance sign-off every time.
  {
    from: 'investigating',
    to: 'resolved',
    requiredRoleKey: 'QUALITY_MANAGER',
    requiresSignature: false,
  },
]

// ── QualCloud (Phase 13) Stage 6 — OOS/OOT Investigation ────────────────

export const QUALITY_OOS_WORKFLOW_RECORD_TYPE = 'quality_oos'

export const QUALITY_OOS_WORKFLOW_STATES = [
  { key: 'phase_1_lab_investigation', name: 'Phase 1 — Lab Investigation', isInitial: true, isTerminal: false },
  { key: 'phase_2_manufacturing_investigation', name: 'Phase 2 — Manufacturing Investigation', isInitial: false, isTerminal: false },
  { key: 'closed', name: 'Closed', isInitial: false, isTerminal: true },
] as const

export const QUALITY_OOS_WORKFLOW_TRANSITIONS: {
  from: string
  to: string
  requiredRoleKey: string
  requiresSignature: boolean
}[] = [
  {
    from: 'phase_1_lab_investigation',
    to: 'phase_2_manufacturing_investigation',
    requiredRoleKey: 'QUALITY_ASSOCIATE',
    requiresSignature: false,
  },
  // The real *Barr Labs* guard: only allowed with a documented assignable
  // lab cause — enforced by `QualityWorkflowGuards`, not just role/signature.
  {
    from: 'phase_1_lab_investigation',
    to: 'closed',
    requiredRoleKey: 'QUALITY_MANAGER',
    requiresSignature: true,
  },
  {
    from: 'phase_2_manufacturing_investigation',
    to: 'closed',
    requiredRoleKey: 'QUALITY_MANAGER',
    requiresSignature: true,
  },
]
