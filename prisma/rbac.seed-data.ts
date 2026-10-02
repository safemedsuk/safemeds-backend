/**
 * Role & Permission catalog, transcribed from `docs/safemeds-user-types.md`
 * section D (Capability Matrix) and the per-role "Can/Cannot" prose above
 * it. Permissions are namespaced `domain.action` per the build spec.
 *
 * Deliberately includes permissions for domains that don't have real
 * endpoints yet (pv.*, quality.*, regulatory.*  — Phases 4-7 build those) —
 * the build spec asks for the *full* catalog seeded now so later phases
 * just add `@RequirePermissions()` to new endpoints against an
 * already-correct matrix, rather than re-deriving it each time.
 */

export interface RoleSeed {
  key: string
  name: string
  description: string
  isPlatform: boolean
  permissions: string[]
}

export interface PermissionSeed {
  key: string
  description: string
}

export const PERMISSIONS: PermissionSeed[] = [
  // ── Tenant: user & company administration ──────────────────────────────
  { key: 'users.invite', description: 'Invite new users to the company' },
  { key: 'users.manage_roles', description: "Change a user's assigned roles" },
  { key: 'users.deactivate', description: 'Deactivate a user (never delete)' },
  { key: 'users.view', description: "View the company's user list" },
  { key: 'users.reset_password', description: 'Force a user to set a new password on next login' },
  { key: 'security_policy.manage', description: "Edit the company's security policy" },
  { key: 'audit.read', description: "Read the company's audit trail" },
  {
    key: 'company_profile.manage',
    description: 'Edit company details, activate operating markets, and manage facility locations',
  },

  // ── Tenant: pharmacovigilance (Phase 5/6) ───────────────────────────────
  { key: 'pv.capture_case', description: 'Create an adverse event report' },
  { key: 'pv.triage_case', description: 'Triage and reassign PV cases' },
  {
    key: 'pv.medical_review',
    description: 'Medical review, MedDRA/WHODrug coding confirmation, and causality assessment',
  },
  {
    key: 'pv.qc_review',
    description:
      'Perform four-eyes QC review — approve/return a case out of Narrative, set the expectedness/listedness flag',
  },
  { key: 'pv.sign_icsr', description: 'Sign and approve an ICSR submission (signature-gated)' },
  { key: 'pv.view_all', description: "View all of the company's PV cases" },
  {
    key: 'pv.manage_clinical_trials',
    description: 'Create and manage clinical trials, and enroll trial subjects',
  },
  {
    key: 'pv.unblind_treatment',
    description:
      "Reveal a clinical-trial subject's blinded treatment-arm assignment (signature-gated)",
  },
  {
    key: 'pv.manage_signals',
    description:
      'Raise and progress signals through their lifecycle (validate, confirm, analyse/prioritise, assess, recommend action — the final recommend-action transition is signature-gated)',
  },
  {
    key: 'pv.manage_literature_monitoring',
    description: 'Log and view literature-monitoring screening runs',
  },
  {
    key: 'pv.view_molecule_intelligence',
    description:
      "View a molecule's cross-market case pattern, including the aggregated cross-tenant view",
  },

  // ── Tenant: VigiCloud Stage 15 — reconciliation & contact testing ───────
  {
    key: 'reconciliation.view',
    description:
      "View the company's distributor list, case-distributor mappings, and reconciliation reports",
  },
  {
    key: 'reconciliation.manage',
    description:
      'Manage the distributor list, manually reconcile cases, and generate reconciliation reports',
  },
  {
    key: 'contact_testing.manage',
    description: 'Start and log contact-channel reachability tests (email/phone)',
  },

  // ── Tenant: quality (Phase 5/6) ─────────────────────────────────────────
  { key: 'quality.log_deviation', description: 'Log deviations, CAPAs, complaints' },
  {
    key: 'quality.close_capa',
    description: 'Approve/close deviations, CAPAs, changes, SOPs (signature-gated)',
  },
  { key: 'quality.view_all', description: "View all of the company's quality records" },
  // QualCloud (Phase 13) Stage 0.4 — the Foundation Layer's own new
  // master-data/document/risk entities each get their own dedicated
  // manage permission rather than overloading `quality.log_deviation`/
  // `quality.manage_capa` (deviation/CAPA-shaped actions) — a supplier
  // approval, an equipment qualification record, or a controlled
  // document is a materially different action from logging a
  // deviation, even though the same QUALITY_ASSOCIATE/QUALITY_MANAGER
  // roles hold all of them today.
  {
    key: 'quality.manage_suppliers',
    description: 'Manage the approved-supplier/vendor register and qualification status',
  },
  {
    key: 'quality.manage_equipment',
    description: 'Manage the equipment register, qualification status, and calibration schedule',
  },
  {
    key: 'quality.manage_documents',
    description: 'Create and manage controlled documents (SOPs) and specifications',
  },
  {
    key: 'quality.manage_recalls',
    description: 'Manage product recalls and recall investigations',
  },
  // QualCloud (Phase 13) Stage 10.8 — the real RECALL.CREATE/EDIT and
  // SCOPE.EDIT persona from the Engineering Build Package's own
  // permission matrix: day-to-day drafting/logging across the whole
  // recall lifecycle (countries, scope drafts, distribution,
  // stakeholders, sightings, the external portal, messages,
  // quarantine/returns, reconciliation calculation, discrepancy
  // logging, destruction progression, effectiveness checks) —
  // deliberately distinct from `quality.manage_recalls` (kept, now
  // scoped to the two "generate an official archived output" actions:
  // the compliance pack and the mock-recall readiness export) and from
  // the narrower sign-off-shaped `quality.approve_recall_scope`/
  // `quality.approve_recall_exception` pair.
  {
    key: 'quality.log_recall',
    description: 'Draft and log day-to-day recall case management (countries, scope, distribution, portal, quarantine/returns, reconciliation)',
  },
  // QualCloud (Phase 13) Stage 10.5 — two deliberately narrower,
  // sign-off-shaped actions carved out of the broader
  // `quality.manage_recalls` (Head-of-Quality-only, matching that
  // permission's own established `quality.manage_batch_release`-style
  // "approval-level action" precedent): freezing a scope version and
  // approving a blocking-discrepancy exception are both real,
  // e-signature-adjacent compliance decisions on top of ordinary recall
  // case management, not a bigger blast radius, but a distinct one —
  // held by the same role (`QUALITY_MANAGER`) as `quality.manage_recalls`
  // today, split out so a future role split (e.g. a QP-equivalent
  // approver distinct from whoever runs the case day to day) doesn't
  // need a breaking permission rename.
  {
    key: 'quality.approve_recall_scope',
    description: 'Freeze a recall’s product/batch scope version, making it immutable',
  },
  {
    key: 'quality.approve_recall_exception',
    description: 'Approve an exception on a blocking recall reconciliation discrepancy',
  },
  {
    key: 'quality.manage_batch_release',
    description: 'Manage batch release/QP disposition decisions',
  },
  {
    key: 'quality.manage_validation',
    description: 'Manage validation/qualification protocols and reports',
  },
  { key: 'quality.view_pqr', description: 'View Product Quality Reviews' },
  // QualCloud (Phase 13) Stage 7 — the QA *batch-record* review/
  // disposition, deliberately distinct from `quality.manage_batch_release`
  // (Stage 17's own, later, more senior Qualified-Person release gate —
  // never conflated with this one, see `BatchRecordReview`'s own schema
  // doc comment).
  {
    key: 'quality.review_batch_records',
    description: 'Review executed batch records and record a QA disposition (pre-QP)',
  },
  // QualCloud (Phase 13) Stage 8 — Metrics, Trending & Management Review.
  {
    key: 'quality.view_metrics',
    description: 'View quality metrics, trend flags, and management review history',
  },
  {
    key: 'quality.manage_management_review',
    description: 'Schedule management reviews and record their agreed actions',
  },
  // QualCloud (Phase 13) Stage 11 — the sign-off-shaped supplier
  // approval decision, carved out of the broader `quality.manage_suppliers`
  // (drafting-level: assess, schedule a qualification audit, monitor/
  // flag performance), matching the exact `quality.approve_recall_scope`/
  // `quality.manage_recalls` split precedent — a QUALITY_MANAGER-only
  // approval-level action, not a bigger blast radius than
  // `quality.manage_suppliers`, but a distinct one.
  {
    key: 'quality.approve_suppliers',
    description: 'Approve or suspend/disqualify a supplier\'s approval status',
  },
  // QualCloud (Phase 13) Stage 13 — Product Quality Review & Quality
  // Risk Management. `quality.view_pqr` (pre-existing since Stage 0.4)
  // already covers viewing an assembled/reviewed PQR; this is the
  // distinct, signature-gated review/sign-off action, matching
  // `quality.manage_management_review`'s own "assembling/viewing is
  // broader than formally signing off" split.
  {
    key: 'quality.manage_pqr',
    description: 'Assemble, review, and sign off Product Quality Reviews',
  },
  // QualCloud (Phase 13) Stage 15 — Pharmaceutical Waste Management.
  // Granted to both quality roles, matching `quality.manage_suppliers`/
  // `quality.manage_equipment`'s own symmetric precedent — logging a
  // disposal and witnessing one are both ordinary quality operations,
  // not a senior-only sign-off the way `quality.manage_batch_release` is.
  {
    key: 'quality.manage_waste_disposal',
    description: 'Log pharmaceutical waste disposal records and sign as a destruction witness',
  },
  // QualCloud (Phase 13) Stage 16 — Falsified & Substandard Product
  // Handling. Same symmetric grant as `quality.manage_waste_disposal`
  // above — reporting, confirming, dismissing, and closing a falsified-
  // product report are all ordinary quality-operations actions here,
  // not split into a separate drafting/approval pair the way CAPA/
  // recall/supplier-approval are.
  {
    key: 'quality.manage_falsified_reports',
    description: 'Report, confirm, dismiss, and close falsified/substandard product reports',
  },
  // QualCloud (Phase 13) Stage 19 — Environmental Monitoring &
  // Stability Programme. Symmetric grant to both quality roles, same
  // "ordinary quality operations, not a senior-only sign-off" rationale
  // as `quality.manage_waste_disposal`/`quality.manage_falsified_reports`
  // above — logging an EM reading or a stability timepoint result is a
  // routine QA action, not an approval decision.
  {
    key: 'quality.manage_environmental_monitoring',
    description: 'Log environmental monitoring results and review excursions',
  },
  {
    key: 'quality.manage_stability',
    description: 'Create stability studies and record stability timepoint results',
  },

  // ── Tenant: regulatory affairs (Phase 4/7) ──────────────────────────────
  {
    key: 'regulatory.manage_registrations',
    description: 'Manage product registrations, renewals, dossiers',
  },
  { key: 'regulatory.view_all', description: "View all of the company's regulatory records" },
  // RegCloud (Phase 12) Stage 0 — manufacturers/manufacturing sites/local
  // representatives (0.2) and dossier compilation/document attach-detach
  // (0.3) are deliberately separate from `regulatory.manage_registrations`
  // above: managing the entity/hierarchy graph and assembling a dossier are
  // real, distinct actions from editing a registration record itself, and
  // a future engagement-model split (Stage 15) may grant them to different
  // actors. The country rule-set graph's own admin CRUD (`RegulatoryRequirement`/
  // `RegulatoryFeeSchedule`/`RegDeadlineRule`) deliberately reuses the
  // existing platform-side `platform.config.manage` instead of a new
  // permission — see `RegConfigController`'s own doc comment for why.
  {
    key: 'regulatory.manage_entities',
    description: 'Manage manufacturers, manufacturing sites, and local representatives',
  },
  {
    key: 'regulatory.manage_dossier',
    description: 'Compile a registration dossier and attach/detach its documents',
  },
  // Stage 0.5 — same "distinct action, distinct permission" reasoning as
  // 0.2/0.3's own two grants above; managing what's owed/paid on a
  // registration is a real, separate action from editing the registration
  // record itself.
  {
    key: 'regulatory.manage_fees',
    description: 'Create fee invoices, record payments, and waive fees in the RegCloud fee ledger',
  },
  // RegCloud (Phase 12) Stage 0.6 — seeded now for stages that don't have a
  // real endpoint yet, matching this file's own opening-comment precedent
  // ("the build spec asks for the full catalog seeded now so later phases
  // just add @RequirePermissions() to new endpoints against an
  // already-correct matrix"). `regulatory.view_all` (above) already covers
  // read access for all of these; no separate `*.view` variant needed.
  // Stage 4 — real endpoint since 22 Aug 2026 (`RegSubmissionController`):
  // generate a submission package and attach dispatch evidence.
  {
    key: 'regulatory.submit',
    description: 'Generate and dispatch a registration dossier submission package to a regulator',
  },
  // Stage 7 — real endpoint since 22 Aug 2026 (`RegVariationController`).
  // Renewal folds into this same permission (`variationType: 'renewal'` —
  // see `RegVariation`'s own schema doc comment for why), so
  // `regulatory.manage_renewals` immediately below stays reserved/unused
  // rather than wired to a second endpoint — revisit only if a real
  // discovery answer says renewals need a genuinely distinct remit from
  // content variations.
  {
    key: 'regulatory.manage_variations',
    description: 'File and manage post-approval registration variations and renewals',
  },
  {
    key: 'regulatory.manage_renewals',
    description:
      'Reserved — renewal is handled via regulatory.manage_variations (variationType: "renewal"); no separate endpoint exists or is currently planned',
  },
  // Stage 10 — real endpoint since 22 Aug 2026 (`FacilitiesController
  // .updateLicence()`, `PersonnelLicenceController`).
  {
    key: 'regulatory.manage_licensing',
    description:
      'Manage establishment/premises operating licences and personnel professional-registration records',
  },
  // Stage 11 — real endpoint since 22 Aug 2026 (`ImportExportPermitController`).
  { key: 'regulatory.manage_import_export', description: 'Manage import/export permits' },
  // Stage 14 — real endpoint since 23 Aug 2026 (`RecallController`).
  {
    key: 'regulatory.manage_recalls',
    description:
      'Manage product recalls, including notifying the authority and linking related PV cases',
  },
  // Stage 8 — real endpoint since 22 Aug 2026 (`RegPostMarketObligationController`).
  {
    key: 'regulatory.manage_obligations',
    description:
      'Log and fulfill recurring post-market compliance obligations (annual reports, periodic safety-and-quality updates)',
  },
  // Stage 13 — real endpoint since 23 Aug 2026 (`PromotionalMaterialSubmissionController`).
  {
    key: 'regulatory.manage_promotional_material',
    description: 'Submit and review promotional/advertising material for regulatory approval',
  },
  // testing-correction-explanation.md §3.3 — real endpoint since 26 Sep
  // 2026 (`RegRetentionController`). Deliberately its own permission, not
  // folded into `regulatory.manage_renewals`/`regulatory.manage_variations`
  // — paying and logging an annual retention fee is a distinct, routine
  // action a company may want to grant separately from substantive
  // variation/renewal filing authority.
  {
    key: 'regulatory.manage_retentions',
    description: "Log a registration's annual retention (invoice, proof of payment) and receive its certificate",
  },

  // ── Tenant: cross-domain ─────────────────────────────────────────────────
  {
    key: 'records.view_all',
    description: 'View all company records across every domain, read-only',
  },

  // ── Tenant: electronic signatures (Phase 6) ─────────────────────────────
  { key: 'signatures.read', description: "View a record's signature history" },
  { key: 'signatures.verify', description: "Recompute and verify a signature's hash integrity" },

  // ── Tenant: master data (Phase 7) ───────────────────────────────────────
  {
    key: 'master_data.view',
    description: "View the company's products, batches, and registrations",
  },
  {
    key: 'master_data.manage',
    description: 'Create/update/deactivate products, batches, and registrations',
  },

  // ── Tenant: documents (Phase 8) ─────────────────────────────────────────
  { key: 'documents.view', description: 'View documents attached to any company record' },
  { key: 'documents.manage', description: 'Upload new document versions' },

  // ── Tenant: VigiCloud Stage 0 base-engine primitives ────────────────────
  // (todo-vigicloud.md Stage 0.1/0.2 — cross-cutting, not PV-specific;
  // QualCloud/RegCloud reuse the same ConsentRecord/DataSubjectRequest
  // tables and permissions once they exist.)
  {
    key: 'consent.manage',
    description: 'Capture, withdraw, and view consent records for any company record',
  },
  {
    key: 'data_privacy.manage',
    description: 'Handle data-subject access (export) and erasure requests',
  },

  // ── Tenant: VigiCloud Stage 0.10 — generic Reports primitive ────────────
  // (create/store/track a generated output — PSUR, line listing, etc. —
  // for any module; reused by QualCloud/RegCloud once they exist)
  {
    key: 'reports.view',
    description: 'View generated reports (PSURs, line listings, and similar) across every module',
  },
  { key: 'reports.manage', description: 'Create, finalize, and submit generated reports' },

  // ── Tenant: VigiCloud Stage 16 — Governance & Audit Module ──────────────
  {
    key: 'psmf.view',
    description: "View the company's PSMF (Pharmacovigilance System Master File) version history",
  },
  { key: 'psmf.manage', description: 'Create a new PSMF draft (build or upload) and activate it' },
  {
    key: 'governance.view',
    description: 'View the audit-readiness dashboard and its 15 requirement rows',
  },
  {
    key: 'governance.manage',
    description: 'Update audit-requirement evidence/status and generate an audit pack',
  },
  {
    key: 'quality.manage_capa',
    description:
      'Schedule internal audits, log findings, and open/update CAPAs (closing one still requires quality.close_capa)',
  },
  {
    key: 'qppv.manage_nomination',
    description:
      "Set a company's primary/backup QPPV, generate the nomination letter, and upload the regulator's confirmation",
  },
  {
    key: 'sdea.view',
    description: "View the company's SDEA (Safety Data Exchange Agreement) repository",
  },
  { key: 'sdea.manage', description: 'Upload/renew SDEAs and manage their expiry' },
  { key: 'training.view', description: "View the company's training records" },
  { key: 'training.manage', description: 'Log training records and upload certificates' },

  // ── Tenant: VigiCloud Stage 18 — Reporting & Periodic Outputs ───────────
  { key: 'rmp.view', description: "View a product's Risk Management Plan version history" },
  { key: 'rmp.manage', description: 'Create a new RMP draft and activate it, per product' },
  {
    key: 'safety_alerts.view',
    description: "View the company's logged safety alerts and any generated DHCP/DIL letters",
  },
  {
    key: 'safety_alerts.manage',
    description: 'Log a safety alert, review/action/dismiss it, and generate a DHCP/DIL letter',
  },

  // ── Platform ──────────────────────────────────────────────────────────────
  {
    key: 'platform.registrations.review',
    description: 'Review, approve, or reject company registrations',
  },
  { key: 'platform.tenants.suspend', description: 'Suspend or reinstate a tenant company' },
  { key: 'platform.staff.manage', description: 'Manage platform-internal staff accounts' },
  {
    key: 'platform.support.access',
    description: 'Time-boxed break-glass read access into a tenant',
  },
  { key: 'platform.audit.read', description: 'Read platform-internal audit trails' },
  {
    key: 'platform.config.manage',
    description:
      'Manage country regulatory configuration (reporting rules, form schemas, submission formats, regulatory authorities, and audit-requirement definitions)',
  },
  {
    key: 'platform.entitlements.manage',
    description: 'Grant or revoke module/feature entitlements for a tenant company',
  },
  {
    key: 'platform.rbac.manage',
    description: 'Create/edit permissions and roles, and change which permissions a role carries',
  },
  // QualCloud (Phase 13) Stage 10.1 — the recall country rules engine's
  // own admin/platform half. Deliberately its own, narrower permission
  // rather than folding into `platform.config.manage` — a recall
  // rule-set is a distinct rule domain (recall obligations, not
  // ADR-reporting/registration-renewal deadlines) with its own real
  // sign-off author, Dr. Miano (the Country Rules Content Pack's own
  // named `regulatory_lead` persona), held only by `regulatory_lead`,
  // never `super_admin` alone, matching that role's own established
  // narrow-scope precedent.
  {
    key: 'platform.recall_rules.manage',
    description:
      'Author and sign off recall country rule-sets (per-country recall obligation deadlines and submission templates)',
  },
]

export const ROLES: RoleSeed[] = [
  // ── Tenant-side (8) ───────────────────────────────────────────────────────
  {
    key: 'SYSTEM_ADMINISTRATOR',
    name: 'System Administrator',
    description: "The tenant's own IT/ops owner — administration, not regulated action.",
    isPlatform: false,
    permissions: [
      'users.invite',
      'users.manage_roles',
      'users.deactivate',
      'users.view',
      'users.reset_password',
      'security_policy.manage',
      'company_profile.manage',
      'audit.read',
      'records.view_all',
      'signatures.read',
      'signatures.verify',
      'master_data.view',
      'master_data.manage',
      'documents.view',
      'documents.manage',
      'consent.manage',
      'data_privacy.manage',
      'reports.view',
      'reports.manage',
      // `reconciliation.view` added Stage 15 — administration-flavored
      // read visibility, matching this role's own broad `records.view_all`
      // remit; the granular grant still matters since not every service's
      // read-gate treats `records.view_all` as an automatic OR-alternative.
      'reconciliation.view',
      // Stage 16 — PSMF/QPPV-appointment/SDEA/training visibility and
      // management are squarely "administration, not regulated action"
      // (this role's own description) — PSMF and QPPV nomination are
      // onboarding-adjacent admin tasks a System Administrator routinely
      // handles alongside company profile setup; `governance.manage` is
      // deliberately withheld (curating audit-readiness *evidence* is a
      // PV/quality judgment call, not an admin one).
      'psmf.view',
      'psmf.manage',
      'governance.view',
      'qppv.manage_nomination',
      'sdea.view',
      'training.view',
      // Stage 18 — read visibility into RMP/safety-alert status, matching
      // this role's existing broad-but-read-only stance on every other
      // PV/quality regulatory artifact (`psmf.view`, `sdea.view`, ...);
      // actually managing either is a medical/regulatory judgment call
      // withheld here the same way `governance.manage` already is.
      'rmp.view',
      'safety_alerts.view',
    ],
  },
  {
    key: 'DISPENSING_PHARMACIST',
    name: 'Dispensing Pharmacist',
    description: 'Front-line pharmacist — captures adverse events on their own reports only.',
    isPlatform: false,
    // `documents.manage` added Stage 1: intake attaches the case's mandatory
    // SourceDocument (the original report artifact) via the generic
    // `POST /records/:type/:id/documents` handshake, which is gated by this
    // permission regardless of record type — a pharmacist who can capture a
    // case but not attach its source document couldn't complete intake.
    permissions: [
      'pv.capture_case',
      'master_data.view',
      'documents.view',
      'documents.manage',
      'consent.manage',
      'reports.view',
    ],
  },
  {
    key: 'SUPERINTENDENT_PHARMACIST',
    name: 'Superintendent Pharmacist',
    description:
      'Legally responsible pharmacist — triage and reassignment across all company PV cases.',
    isPlatform: false,
    permissions: [
      'pv.capture_case',
      'pv.triage_case',
      'pv.view_all',
      'signatures.read',
      'master_data.view',
      'documents.view',
      'documents.manage',
      'consent.manage',
      'reports.view',
    ],
  },
  {
    key: 'QPPV',
    name: 'QPPV (PV Contact)',
    description: 'Qualified Person for Pharmacovigilance — medical review and ICSR sign-off.',
    isPlatform: false,
    // `pv.manage_clinical_trials`/`pv.unblind_treatment` added Stage 14:
    // QPPV is the medically-responsible person for the trial's local
    // safety obligations, the same reasoning `pv.sign_icsr` already rests
    // on — unblinding a subject's treatment arm is exactly the kind of
    // signature-gated regulated act this role already owns the pattern
    // for, not a new kind of trust.
    permissions: [
      'pv.capture_case',
      'pv.triage_case',
      'pv.medical_review',
      'pv.sign_icsr',
      'pv.view_all',
      'pv.manage_clinical_trials',
      'pv.unblind_treatment',
      // Real-usage request, 22 Sep 2026 — "a QPPV should be able to do
      // quality checks." `pv.qc_review` was previously
      // `QUALITY_ASSOCIATE`-only; withholding it from QPPV was never a
      // deliberate segregation-of-duties decision, just an oversight —
      // the actual self-certification risk (a reviewer clearing their
      // own causality assessment) is already independently enforced,
      // per case, by the four-eyes workflow guard on
      // narrative→quality_check (`PvWorkflowGuards`), which blocks the
      // *specific actor* who assessed a case from also being the one
      // who clears its QC, regardless of which roles hold this
      // permission in the abstract.
      'pv.qc_review',
      'signatures.read',
      'master_data.view',
      'documents.view',
      'consent.manage',
      'reports.view',
      'reports.manage',
      // `contact_testing.manage` added Stage 15 — QPPV is the literal
      // subject of the "24/7 QPPV reachability" evidence this feature
      // exists to produce, and the user's own note names QPPV explicitly
      // ("QPPV/quality can run a test any time").
      'contact_testing.manage',
      // Stage 16 — QPPV "shall permanently and continuously have at
      // their disposal" a PSMF (GUD/006 §2.1), making QPPV the natural
      // owner of building/maintaining it, not just reading it; QPPV also
      // owns most of the audit-readiness dashboard's evidence (medical
      // review records, training compliance) and the training program
      // itself (GVP certification tracking). `qppv.manage_nomination` is
      // deliberately withheld — a QPPV shouldn't be the one appointing
      // (or replacing) themselves.
      'psmf.view',
      'psmf.manage',
      'governance.view',
      'governance.manage',
      'training.view',
      'training.manage',
      'sdea.view',
      // Stage 17 — signal management is a real medical/regulatory
      // judgment call end to end (validation, confirmation, analysis and
      // prioritisation, assessment, recommendation for action), the same
      // remit `pv.medical_review`/`pv.sign_icsr` already put with QPPV —
      // not a new kind of trust, the same one applied to a different
      // artifact (a pattern across cases, not a single case).
      'pv.manage_signals',
      // Stage 18 — an RMP's actual content (risk minimisation measures,
      // safety-concern summary) is medical/scientific judgment, the same
      // remit `pv.medical_review`/`pv.manage_signals` already put with
      // QPPV; a safety alert's review and any DHCP/DIL letter it
      // produces is likewise QPPV's own signal-management remit applied
      // to an externally-sourced signal instead of an internally-detected
      // one.
      'rmp.view',
      'rmp.manage',
      'safety_alerts.view',
      'safety_alerts.manage',
      // Stage 19 — QPPV is who the literature-monitoring reminder task
      // is assigned to (the same "QPPV owns proving PV oversight
      // obligations are met" remit `training.manage`/`psmf.manage`
      // already put with this role), and molecule intelligence is a
      // medical/regulatory pattern-recognition judgment, the same remit
      // `pv.manage_signals` already established.
      'pv.manage_literature_monitoring',
      'pv.view_molecule_intelligence',
    ],
  },
  {
    key: 'QUALITY_ASSOCIATE',
    name: 'Quality Associate',
    description: 'QA/QC staff — logs deviations, CAPAs, complaints; cannot close them.',
    isPlatform: false,
    // `pv.view_all` (not `pv.capture_case`) added Stage 1: this role is the
    // required actor for the seeded pv_case workflow's narrative→quality_check
    // transition (`workflow.seed-data.ts`), so it must be able to see the
    // case it's being asked to act on via `GET /pv/cases/:id` — without this
    // the role could transition a workflow instance (role-gated, generic
    // `POST /workflow/instances/:id/transition`) but never actually view the
    // case content behind it. `pv.qc_review` added Stage 9: this is the real
    // QC-reviewer permission the seeded workflow's narrative→quality_check
    // transition role always implied but never had a matching permission for
    // until now.
    // `reconciliation.view`/`contact_testing.manage` added Stage 15 — QA/QC
    // staff are the other role the user's own note names for contact
    // testing ("QPPV/quality can run a test any time"); reconciliation
    // stays read-only here since manually mapping a case to a distributor
    // (and generating the archived report) is `reconciliation.manage`,
    // held by Quality Manager/Regulatory Affairs Officer below, not this role.
    // `quality.manage_capa`/`governance.*`/`psmf.view`/`sdea.view`/
    // `training.view` added Stage 16 — this role can schedule internal
    // audits, log findings, open/update CAPAs, and curate audit-readiness
    // evidence (all "logging," not "closing"), matching exactly the
    // `quality.log_deviation` vs. `quality.close_capa` split this role
    // already lives under — `quality.close_capa` (the CAPA
    // effectiveness-check + closure gate) stays withheld here on purpose.
    permissions: [
      'quality.log_deviation',
      'quality.view_all',
      'pv.view_all',
      'pv.qc_review',
      // `pv.triage_case` added 19 Aug 2026, real-usage feedback ("more
      // people should see, claim it and then work on them") — this role
      // already held `pv.view_all`, so extending it to also triage/
      // confirm draft-review-queue cases (public URL/email/WhatsApp
      // intake with no human captor) is a small, natural widening of an
      // already-broad view permission, not a new trust boundary.
      'pv.triage_case',
      'master_data.view',
      'documents.view',
      'consent.manage',
      'reports.view',
      'reconciliation.view',
      'contact_testing.manage',
      'quality.manage_capa',
      'governance.view',
      'governance.manage',
      'psmf.view',
      'sdea.view',
      'training.view',
      // Stage 18 — read-only, matching this role's own established
      // "logging/viewing, not the medical judgment call" split
      // (`pv.qc_review` aside, which is a defined checklist, not an
      // open-ended safety assessment the way RMP content/safety-alert
      // review is).
      'rmp.view',
      'safety_alerts.view',
      // QualCloud (Phase 13) Stage 0.4 — drafting/logging-level quality
      // master data (suppliers, equipment, controlled documents) and
      // PQR viewing, matching this role's own established
      // "logs/drafts, doesn't close/approve" stance
      // (`quality.close_capa`/`quality.manage_recalls`/
      // `quality.manage_validation` stay withheld here on purpose,
      // same split as `quality.log_deviation` vs. `quality.close_capa`
      // above). `quality.manage_batch_release` is deliberately granted
      // to no role yet — the todo-qualcloud.md plan itself names this
      // Qualified-Person-only, deferred to Stage 17's own real QP gate
      // rather than guessed at here.
      'quality.manage_suppliers',
      'quality.manage_equipment',
      'quality.manage_documents',
      'quality.view_pqr',
      'quality.review_batch_records',
      // QualCloud (Phase 13) Stage 8 — this role can see the metrics/
      // trend picture, but scheduling/deciding a formal management
      // review stays a QUALITY_MANAGER-only leadership action (below).
      'quality.view_metrics',
      // QualCloud (Phase 13) Stage 10.8 — RECALL.CREATE/EDIT/SCOPE.EDIT
      // (`quality.log_recall`, drafting-level day-to-day recall case
      // management) plus `regulatory.view_all`, closing a real gap
      // found while wiring this: without it, this role could log every
      // recall sub-mechanism this stage builds but couldn't actually
      // see the parent `Recall` row itself (`GET /recalls`/`GET
      // /recalls/:id` were `regulatory.view_all`-gated only, held
      // exclusively by Regulatory Affairs Officer until now).
      // `quality.manage_recalls`/`quality.approve_recall_scope`/
      // `quality.approve_recall_exception` (the sign-off-shaped
      // actions) stay withheld here, same "logs, doesn't approve"
      // split as everything else on this role.
      'quality.log_recall',
      'regulatory.view_all',
      // QualCloud (Phase 13) Stage 15/16.
      'quality.manage_waste_disposal',
      'quality.manage_falsified_reports',
      'quality.manage_environmental_monitoring',
      'quality.manage_stability',
    ],
  },
  {
    key: 'QUALITY_MANAGER',
    name: 'Quality Manager',
    description: 'Head of Quality — approves/closes deviations, CAPAs, SOPs (signature-gated).',
    isPlatform: false,
    permissions: [
      'quality.log_deviation',
      'quality.close_capa',
      'quality.view_all',
      'signatures.read',
      'master_data.view',
      'master_data.manage',
      'documents.view',
      'documents.manage',
      'consent.manage',
      'reports.view',
      'reports.manage',
      // `reconciliation.manage`/`contact_testing.manage` added Stage 15 —
      // Quality owns the manufacturer-distributor reconciliation process
      // (the same domain SDEA/Stage 16.5 will own) and is one of the two
      // roles the user's own note names for contact testing.
      'reconciliation.manage',
      'contact_testing.manage',
      // Stage 16 — Quality Manager is this company's governance owner:
      // full PSMF/audit-readiness/CAPA-closure/SDEA/training management,
      // plus co-owning QPPV nomination administratively alongside System
      // Administrator (both a compliance and an admin concern).
      'psmf.view',
      'psmf.manage',
      'governance.view',
      'governance.manage',
      'quality.manage_capa',
      'qppv.manage_nomination',
      'sdea.view',
      'sdea.manage',
      'training.view',
      'training.manage',
      // Stage 18 — read-only, same governance-owner-but-not-the-medical-
      // judgment-call stance this role already takes on `pv.*`.
      'rmp.view',
      'safety_alerts.view',
      // QualCloud (Phase 13) Stage 0.4 — Quality Manager is Head of
      // Quality, so unlike QUALITY_ASSOCIATE this role also gets
      // `quality.manage_recalls`/`quality.manage_validation` (approval-
      // level actions, matching the `quality.close_capa` split it
      // already holds). `quality.manage_batch_release` stays withheld
      // here too — see the QUALITY_ASSOCIATE comment above, deferred to
      // Stage 17's real Qualified-Person gate.
      'quality.manage_suppliers',
      'quality.manage_equipment',
      'quality.manage_documents',
      'quality.manage_recalls',
      // Stage 10.5 — the two sign-off-shaped recall actions carved out
      // of the above, same role.
      'quality.approve_recall_scope',
      'quality.approve_recall_exception',
      // Stage 10.8 — the same drafting-level permission QUALITY_ASSOCIATE
      // now holds too (Head of Quality can obviously also do the
      // day-to-day logging, not just approve it) plus `regulatory.view_all`,
      // closing the same real "couldn't see the parent Recall row"
      // gap documented on QUALITY_ASSOCIATE above.
      'quality.log_recall',
      'regulatory.view_all',
      'quality.manage_validation',
      'quality.view_pqr',
      'quality.review_batch_records',
      // QualCloud (Phase 13) Stage 8 — the real ICH Q10 management-review
      // owner ("Head of Quality").
      'quality.view_metrics',
      'quality.manage_management_review',
      // QualCloud (Phase 13) Stage 11 — the sign-off-shaped supplier
      // approval decision (`quality.manage_suppliers`, drafting-level,
      // is already held above).
      'quality.approve_suppliers',
      // QualCloud (Phase 13) Stage 12 — Training & Competency
      // Management: curriculum definition and recording competency
      // assessments are both kept at this role's own established
      // "manage" level — `training.manage` is already held above
      // (Stage 16.6), so no new grant is needed here, just the usage.
      // QualCloud (Phase 13) Stage 13 — Product Quality Review sign-off
      // (`quality.view_pqr`, assembling/viewing a draft, is already
      // held by both quality roles).
      'quality.manage_pqr',
      // QualCloud (Phase 13) Stage 15/16.
      'quality.manage_waste_disposal',
      'quality.manage_falsified_reports',
      'quality.manage_environmental_monitoring',
      'quality.manage_stability',
    ],
  },
  {
    key: 'REGULATORY_AFFAIRS_OFFICER',
    name: 'Regulatory Affairs Officer',
    description: 'Manages registrations, renewals, and authority relationships.',
    isPlatform: false,
    permissions: [
      'regulatory.manage_registrations',
      'regulatory.view_all',
      // RegCloud (Phase 12) Stage 0 — extending this already-existing role
      // rather than introducing a new one, per `todo-regcloud.md`'s own
      // Stage 0.6 note ("extend the existing role first, split further
      // only if a real discovery answer says two distinct people do these
      // jobs").
      'regulatory.manage_entities',
      'regulatory.manage_dossier',
      'regulatory.manage_fees',
      // Stage 0.6 — placeholder grants for stages with no endpoint yet
      // (see the `PERMISSIONS` catalog's own comment on these six keys).
      'regulatory.submit',
      'regulatory.manage_variations',
      'regulatory.manage_renewals',
      'regulatory.manage_licensing',
      'regulatory.manage_import_export',
      'regulatory.manage_recalls',
      'regulatory.manage_obligations',
      'regulatory.manage_promotional_material',
      'regulatory.manage_retentions',
      // QualCloud (Phase 13) Stage 10.8 — preserves this role's own
      // pre-existing ability to create/log a recall
      // (`quality.log_recall`, shared with the two Quality roles) and
      // adds `quality.view_all` so the QualCloud-owned sub-mechanisms
      // this role needs to see in order to generate a regulator
      // submission (countries, scope, reconciliation, etc.) are
      // actually visible — `regulatory.manage_recalls` itself is now
      // scoped narrowly to SUBMISSION.GENERATE/mark-submitted only.
      'quality.log_recall',
      'quality.view_all',
      // `pv.view_all` added Stage 1 — this role is the required actor for
      // the seeded pv_case workflow's final submission_ready→submitted
      // transition, so it must be able to see the case it's submitting.
      'pv.view_all',
      // `pv.triage_case` added 19 Aug 2026, real-usage feedback — same
      // "already holds pv.view_all, extending to draft-review triage is a
      // small widening" reasoning as `QUALITY_ASSOCIATE`'s own note above.
      'pv.triage_case',
      // `pv.manage_clinical_trials` added Stage 14 — trial setup
      // (protocol reference, ethics-committee contact, portal reference)
      // is regulatory-affairs administrative work, distinct from the
      // signature-gated unblinding action QPPV alone holds.
      'pv.manage_clinical_trials',
      'signatures.read',
      'master_data.view',
      'master_data.manage',
      'documents.view',
      'documents.manage',
      'consent.manage',
      'reports.view',
      'reports.manage',
      // `reconciliation.manage` added Stage 15 — the manufacturer-
      // distributor relationship is an authority/agreement relationship
      // (the same one Stage 16.5's SDEA record will govern), squarely
      // within this role's existing "authority relationships" remit.
      'reconciliation.manage',
      // Stage 16 — `sdea.manage` follows the exact same "authority/
      // agreement relationships" reasoning as `reconciliation.manage`
      // above (an SDEA literally is the formal agreement governing a
      // distributor relationship); `qppv.manage_nomination` fits this
      // role's regulator-facing remit (the nomination letter and its
      // confirmation are both regulator correspondence); `governance.view`/
      // `psmf.view` are read visibility into the company's overall
      // compliance posture, not a new management responsibility.
      'sdea.view',
      'sdea.manage',
      'qppv.manage_nomination',
      'governance.view',
      'psmf.view',
      // Stage 18 — an RMP is a real regulator-facing submission (track
      // its version, submission, renewal), squarely within this role's
      // existing "manages registrations, renewals, and authority
      // relationships" remit — the same reasoning already granted
      // `sdea.manage`. Safety alerts stay read-only here; reviewing one
      // and deciding on a DHCP/DIL letter is QPPV's medical judgment.
      'rmp.view',
      'rmp.manage',
      'safety_alerts.view',
      // Stage 19 — cross-market molecule intelligence directly informs
      // registration/renewal strategy, this role's existing remit.
      'pv.view_molecule_intelligence',
    ],
  },
  {
    key: 'EXECUTIVE_READONLY',
    name: 'Executive (Read-only)',
    description: 'Leadership — reads everything, acts on nothing.',
    isPlatform: false,
    // Stage 16 read-only additions follow the same blanket "reads
    // everything, acts on nothing" pattern as every prior stage's
    // addition to this role.
    permissions: [
      'records.view_all',
      'audit.read',
      'signatures.read',
      'master_data.view',
      'documents.view',
      'reports.view',
      'reconciliation.view',
      'psmf.view',
      'governance.view',
      'sdea.view',
      'training.view',
      'rmp.view',
      'safety_alerts.view',
      'pv.view_molecule_intelligence',
    ],
  },

  // ── Platform-side (4) ────────────────────────────────────────────────────
  // `key` intentionally matches the Prisma `PlatformRole` enum values
  // (`super_admin`/`operations`/`support`/`regulatory_lead`) exactly, not a
  // separate naming scheme — permission resolution looks a platform user up
  // by `user.platformRole`, so the two must agree letter-for-letter.
  {
    key: 'super_admin',
    name: 'Platform Super Admin',
    description: 'Founders/CTO — everything platform-side, every cross-tenant read audited.',
    isPlatform: true,
    permissions: [
      'platform.registrations.review',
      'platform.tenants.suspend',
      'platform.staff.manage',
      'platform.audit.read',
      'platform.support.access',
      'platform.config.manage',
      'platform.entitlements.manage',
      // Admin Configuration Console — redefining what a role can do is a
      // platform-wide, every-tenant-at-once change (roles carry no
      // companyId), the same blast radius as `platform.staff.manage`;
      // deliberately withheld from `regulatory_lead` below, which is
      // scoped to country config, not access control.
      'platform.rbac.manage',
      'audit.read',
      'records.view_all',
      'signatures.read',
      'signatures.verify',
    ],
  },
  {
    key: 'operations',
    name: 'Platform Operations',
    description: 'Works the registration review queue.',
    isPlatform: true,
    permissions: ['platform.registrations.review'],
  },
  {
    key: 'support',
    name: 'Platform Support',
    description: 'Future — time-boxed, audited, read-only break-glass tenant access.',
    isPlatform: true,
    permissions: ['platform.support.access'],
  },
  {
    key: 'regulatory_lead',
    name: 'Regulatory Lead',
    description:
      'Field/regulatory domain expert — confirms and maintains country config. No tenant-administrative access (no registration review, no suspend, no staff management).',
    isPlatform: true,
    permissions: [
      'platform.config.manage',
      'platform.audit.read',
      'records.view_all',
      // Stage 10.1 — Dr. Miano's own real persona: extracts and signs
      // off the recall country rules engine's own rule-sets.
      'platform.recall_rules.manage',
    ],
  },
]
