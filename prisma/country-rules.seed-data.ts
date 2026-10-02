/**
 * Phase 4.1 seed data — countries' regulatory authorities, the six official
 * Kenyan PPB/MoH report types, their digitised form schemas, confirmed
 * seriousness criteria, and (deliberately unverified/draft) reporting-rule
 * windows. Transcribed from the six PDFs in `docs/` and cross-checked
 * against `docs/safemeds-domain-knowledge.md` §3.1/§5 and Open Question Q1.
 *
 * Only Kenya gets real content this pass — the other 7 countries get a
 * bare RegulatoryAuthority row (per the build spec's country list) with no
 * rules/forms yet, exactly like `docs/safemeds-domain-knowledge.md`'s §3.2
 * "template awaiting expert input". Building out a second market's forms
 * before a single one is expert-verified would be guessing at guesses.
 */

export interface AuthoritySeed {
  countryIso: string
  code: string
  name: string
  /**
   * VigiCloud Stage 12 — regulatory-letterhead fields, transcribed
   * directly from the real PPB E2B report cover page in
   * `vigicloud docs/E2b5318.pdf` for Kenya's PPB row (its own form code
   * "(FOM001/HPT/VMS/SOP/001)", ministry, P.O. Box, phone, email — every
   * one of them). Left undefined for every other authority — a real,
   * not-yet-closed content gap (the same "only Kenya has real ...
   * data" pattern this file's own header comment already states),
   * not an oversight.
   */
  formCode?: string
  ministryName?: string
  poBoxAddress?: string
  phone?: string
  contactEmail?: string
  emblemAssetKey?: string
}

export const AUTHORITIES: AuthoritySeed[] = [
  {
    countryIso: 'KE',
    code: 'PPB',
    name: 'Pharmacy and Poisons Board',
    formCode: '(FOM001/HPT/VMS/SOP/001)',
    ministryName: 'MINISTRY OF HEALTH',
    poBoxAddress: 'P.O. Box 27663-00506 NAIROBI',
    phone: '+254795743049',
    contactEmail: 'pv@ppb.go.ke',
    emblemAssetKey: 'kenya-coat-of-arms',
  },
  { countryIso: 'KE', code: 'NVIP', name: 'National Vaccines and Immunization Program (DHIS2)' },
  /**
   * VigiCloud Stage 13 — not a national medicines regulator at all; a
   * structurally different reporting *destination* the engine models
   * the same way it models every other authority (see
   * `ReportingRule.submissionDestination`'s own schema doc comment for
   * why this is the cleanest way to reuse `RuleResolutionService`
   * unchanged rather than special-casing a non-regulator destination).
   * Real per-trial Ethics Committee names/contacts live on
   * `ClinicalTrial` itself; this row exists only so a `ReportingRule`
   * (and its 24-hour clock) has somewhere to attach.
   */
  {
    countryIso: 'KE',
    code: 'ETHICS_COMMITTEE',
    name: 'Institutional Ethics Committee / Clinical Trial Portal',
  },
  { countryIso: 'UG', code: 'NDA', name: 'National Drug Authority' },
  /**
   * Real-usage content, 11 Sep 2026 — `vigicloud document formats/Country
   * Specific Requirements-AE and periodic reporting.xlsx`'s own Uganda
   * sheet names UNCST (Uganda National Council for Science and
   * Technology) and site-level IRBs/ECs as the clinical-trial-SAE
   * recipient, distinct from the NDA — the exact same synthetic-authority
   * pattern Kenya's own `ETHICS_COMMITTEE` row (Stage 13) already
   * established, reused per-country rather than invented fresh.
   */
  {
    countryIso: 'UG',
    code: 'ETHICS_COMMITTEE',
    name: 'UNCST / Institutional Review Board (IRB/EC)',
  },
  { countryIso: 'TZ', code: 'TMDA', name: 'Tanzania Medicines and Medical Devices Authority' },
  {
    countryIso: 'TZ',
    code: 'ETHICS_COMMITTEE',
    name: 'Institutional Review Board / Ethics Committee',
  },
  { countryIso: 'RW', code: 'RFDA', name: 'Rwanda FDA' },
  /** The same xlsx's Rwanda sheet routes clinical-trial SAEs to "Rwanda FDA and Ethics Committee" jointly — modeled here as the Ethics Committee destination alone, matching every other country's own single-destination shape; the source's own dual-recipient nuance is preserved in this row's citation text rather than a second, duplicate `RFDA`-authority row for the same event. */
  { countryIso: 'RW', code: 'ETHICS_COMMITTEE', name: 'Rwanda FDA Ethics Committee' },
  { countryIso: 'ET', code: 'EFDA', name: 'Ethiopian Food and Drug Authority' },
  {
    countryIso: 'ET',
    code: 'ETHICS_COMMITTEE',
    name: 'EFDA-Accredited Institutional Review Board',
  },
  {
    countryIso: 'NG',
    code: 'NAFDAC',
    name: 'National Agency for Food and Drug Administration and Control',
  },
  { countryIso: 'ZA', code: 'SAHPRA', name: 'South African Health Products Regulatory Authority' },
  { countryIso: 'GH', code: 'GhFDA', name: 'Ghana Food and Drugs Authority' },
  /** QualCloud (Phase 13) Stage 10.9 — Zimbabwe's own recall-quarantine authority (Country Rules Content Pack, 2015 procedure), added specifically so `RecallRuleSet`/`RecallRule` seeding has a real authority row to attach to. */
  { countryIso: 'ZW', code: 'MCAZ', name: 'Medicines Control Authority of Zimbabwe' },
]

/** `moduleKey` is explicit here (not just relying on the schema default) so the catalog itself documents which domain module each report type belongs to — all six are PV today; `qualcloud`/`regcloud` will add their own entries with their own moduleKey once those modules exist. */
export const REPORT_TYPES: { typeKey: string; name: string; moduleKey: string }[] = [
  { typeKey: 'adr', name: 'Suspected Adverse Drug Reaction', moduleKey: 'pv' },
  { typeKey: 'quality_complaint', name: 'Suspected Poor-Quality Medical Product', moduleKey: 'pv' },
  { typeKey: 'medication_error', name: 'Medication Error', moduleKey: 'pv' },
  { typeKey: 'device_incident', name: 'Medical Device / IVD Incident', moduleKey: 'pv' },
  { typeKey: 'aefi', name: 'Adverse Event Following Immunization', moduleKey: 'pv' },
  { typeKey: 'transfusion_reaction', name: 'Adverse Transfusion Reaction', moduleKey: 'pv' },
  /** VigiCloud Stage 13/14 — solicited, not spontaneous; routes to the Ethics Committee/clinical-trial portal (`submissionDestination`), never PPB. */
  { typeKey: 'clinical_trial_sae', name: 'Clinical Trial Serious Adverse Event', moduleKey: 'pv' },
  /**
   * VigiCloud Stage 18 — not an incident report type at all (no case is
   * ever filed against it); exists purely so a `ReportingRule` row has
   * somewhere to carry `reportingPeriodDays` (Stage 0.11's own periodic-
   * cadence field) for `LineListingService`'s auto-schedule job, per
   * that field's own schema doc comment ("for report types whose
   * obligation is a recurring cadence... rather than an
   * incident-triggered deadline").
   */
  { typeKey: 'line_listing', name: 'Periodic Line Listing', moduleKey: 'pv' },
]

/** Per FOM001 §8.III — confirmed against the source form, not an assumption. Deliberately excludes "other medically important" (not on the Kenyan form). */
export const KENYA_SERIOUSNESS_CRITERIA: { criterionKey: string; label: string }[] = [
  { criterionKey: 'hospitalization', label: 'Hospitalization / Prolonged Hospitalization' },
  { criterionKey: 'disability', label: 'Disability' },
  { criterionKey: 'congenital_anomaly', label: 'Congenital Anomaly' },
  { criterionKey: 'life_threatening', label: 'Life Threatening' },
  { criterionKey: 'death', label: 'Death' },
]

export interface ReportingRuleSeed {
  reportTypeKey: string
  /**
   * Not a DB enum (plain string column) — deliberately, since Kenya's own
   * MAH-facing ICSR rule (see below) needed a THIRD tier the original
   * two-value 'serious' | 'non_serious' model didn't have room for.
   * Known values in use today: 'fatal', 'serious', 'non_serious'.
   */
  seriousnessClass: string
  windowDays: number
  /** Never resolvable to `active` until a human flips this to false — see Q1's history below. */
  unverified: boolean
  note: string
  /** VigiCloud Stage 13 — defaults to `'PPB'` when omitted: every candidate array seeded before this field existed was Kenya's PPB. */
  authorityCode?: string
  /**
   * Real-usage fix, 11 Sep 2026 — defaults to `'KE'` when omitted, same
   * backward-compatible reasoning as `authorityCode`'s own default.
   * Required (in practice, not by the type system) the moment
   * `authorityCode` alone stopped uniquely identifying one authority row
   * — `ETHICS_COMMITTEE` is now seeded per-country (Kenya, Uganda,
   * Tanzania, Rwanda, Ethiopia each have their own), so a candidate
   * targeting a non-Kenya Ethics Committee must set this explicitly or
   * it silently resolves against Kenya's row instead.
   */
  countryIso?: string
  /** VigiCloud Stage 13 — defaults to `'regulator'` when omitted, matching `ReportingRule.submissionDestination`'s own column default. */
  submissionDestination?: string
  /**
   * VigiCloud Stage 18 — Stage 0.11's periodic-cadence field, for a
   * `line_listing`-type row only. `windowDays` is still required by the
   * schema's NOT NULL constraint even on a purely periodic row (it has
   * no incident-triggered meaning here) — seeded equal to
   * `reportingPeriodDays` so it can never be mistaken for a real,
   * different incident-notification window if ever misread.
   */
  reportingPeriodDays?: number
}

/**
 * Q1 (docs/safemeds-domain-knowledge.md §7) is RESOLVED as of 2026-07-28 —
 * and revised a second time the same day once the actual primary source
 * turned up in `docs/GUIDELINES-ON-THE-SAFETY-AND-VIGILANCE-OF-HEALTH-
 * PRODUCTS-AND-TECHNOLOGIES...pdf` (PPB HPT/PDS/VMS/GUD/022 Rev. 2,
 * January 2024), §6.1 "Submission of individual case safety reports
 * (ICSRs)" — the section that specifically governs Marketing Authorization
 * Holders (i.e. SafeMeds tenants), not the separate §5 "Obligations of the
 * Healthcare Professionals" section (spontaneous reporters, a different
 * actor entirely, with its own looser timeline — 48h/15d/30d — not
 * modelled here since SafeMeds tenants are never that actor).
 *
 * §6.1's actual rule has THREE tiers, not two — an earlier pass here only
 * had two (serious=7d, non_serious=15d), based on a verbal steer that
 * turned out to be a simplified/incomplete recollection of this same
 * source:
 *   a. Local FATAL cases: 7 calendar days.
 *   b. Local SERIOUS (non-fatal) cases: 15 calendar days.
 *   c. Local NON-SERIOUS cases: 30 calendar days.
 *   d. ALL FOREIGN cases (serious or not, including fatal) are explicitly
 *      NOT individually reported at all — folded into the PSUR/PBRER
 *      instead. There is deliberately no ReportingRule row for a "foreign"
 *      class — RuleResolutionService returning null for it is correct
 *      until a PBRER-shaped reporting mechanism exists (Phase 11+).
 *
 * All three rows are seeded `unverified: false` — `seedCountryRulesEngine`
 * in `seed.ts` seeds any `unverified: false` row directly as `active`
 * (skipping the normal draft→activate API dance, since a fresh seed run
 * has no prior "previously active" row to retire).
 */
export const KENYA_ADR_REPORTING_RULE_CANDIDATES: ReportingRuleSeed[] = [
  {
    reportTypeKey: 'adr',
    seriousnessClass: 'fatal',
    windowDays: 7,
    unverified: false,
    note: 'PPB GUD/022 Rev.2 §6.1(a), Jan 2024 — local fatal ADR window',
  },
  {
    reportTypeKey: 'adr',
    seriousnessClass: 'serious',
    windowDays: 15,
    unverified: false,
    note: 'PPB GUD/022 Rev.2 §6.1(b), Jan 2024 — local serious (non-fatal) ADR window',
  },
  {
    reportTypeKey: 'adr',
    seriousnessClass: 'non_serious',
    windowDays: 30,
    unverified: false,
    note: 'PPB GUD/022 Rev.2 §6.1(c), Jan 2024 — local non-serious ADR window',
  },
]

/**
 * Device incidents have their OWN, materially different tiering under the
 * same source, §6.5.1 "Reporting of adverse events" (medical devices incl.
 * IVDs) — confirmed distinct from the ADR rule above, not an oversight:
 *   - Death / unanticipated serious injury / serious public-health threat:
 *     **2 calendar days** (far tighter than ADR's 7-day fatal window).
 *   - All other reportable events (the non-serious tier): 30 calendar days.
 * §6.5.1(4) also imposes a *separate* 15-day deadline for the follow-up
 * INVESTIGATION report on a serious event — that's a second, later
 * obligation on top of the 2-day initial notification, not a third
 * seriousness tier; there's no field on `ReportingRule` for a staged
 * "notify, then investigate-and-report" pair yet, so only the initial
 * notification deadline is seeded here. Worth modelling properly before
 * device-incident deadlines are relied on for compliance in production.
 */
export const KENYA_DEVICE_INCIDENT_REPORTING_RULES: ReportingRuleSeed[] = [
  {
    reportTypeKey: 'device_incident',
    seriousnessClass: 'serious',
    windowDays: 2,
    unverified: false,
    note: 'PPB GUD/022 Rev.2 §6.5.1(2), Jan 2024 — death/serious injury/public health threat',
  },
  {
    reportTypeKey: 'device_incident',
    seriousnessClass: 'non_serious',
    windowDays: 30,
    unverified: false,
    note: 'PPB GUD/022 Rev.2 §6.5.1(5), Jan 2024 — all other reportable device events',
  },
]

/**
 * Quality complaints, medication errors, and transfusion reactions have NO
 * explicit MAH-level day-count anywhere in GUD/022 — unlike ADR (§6.1) and
 * device incidents (§6.5.1), which both spell out their own numbers, these
 * three report types are only ever described procedurally ("report using
 * the form"), never with a stated deadline. The candidates below apply
 * §6.1's general ICSR framing (7/15/30) BY ANALOGY, not by direct
 * citation — genuinely unverified, seeded `draft`/`unverified: true`
 * exactly like the old disputed ADR candidates were, structurally
 * blocked from ever going live until a field expert confirms (or
 * corrects) them. See the email drafted for Robert.
 */
export const KENYA_UNVERIFIED_REPORTING_RULE_CANDIDATES: ReportingRuleSeed[] = [
  {
    reportTypeKey: 'quality_complaint',
    seriousnessClass: 'serious',
    windowDays: 7,
    unverified: true,
    note: "No explicit GUD/022 citation — inferred from §6.1's general ICSR framing, needs field-expert confirmation",
  },
  {
    reportTypeKey: 'quality_complaint',
    seriousnessClass: 'non_serious',
    windowDays: 30,
    unverified: true,
    note: "No explicit GUD/022 citation — inferred from §6.1's general ICSR framing, needs field-expert confirmation",
  },
  {
    reportTypeKey: 'medication_error',
    seriousnessClass: 'serious',
    windowDays: 7,
    unverified: true,
    note: "No explicit GUD/022 citation — inferred from §6.1's general ICSR framing, needs field-expert confirmation",
  },
  {
    reportTypeKey: 'medication_error',
    seriousnessClass: 'non_serious',
    windowDays: 30,
    unverified: true,
    note: "No explicit GUD/022 citation — inferred from §6.1's general ICSR framing, needs field-expert confirmation",
  },
  {
    reportTypeKey: 'transfusion_reaction',
    seriousnessClass: 'serious',
    windowDays: 7,
    unverified: true,
    note: "No explicit GUD/022 citation — inferred from §6.1's general ICSR framing, needs field-expert confirmation",
  },
  {
    reportTypeKey: 'transfusion_reaction',
    seriousnessClass: 'non_serious',
    windowDays: 30,
    unverified: true,
    note: "No explicit GUD/022 citation — inferred from §6.1's general ICSR framing, needs field-expert confirmation",
  },
]

/**
 * VigiCloud Stage 18 — no PPB source (primary or Final-doc-relayed)
 * states a concrete line-listing cadence in days; GUD/022 doesn't
 * mention line listings by name at all. `reportingPeriodDays: 28` ("every
 * 4 weeks") is a reasonable placeholder within the Final doc's own
 * "weekly or 4-6-weekly" framing, not a cited figure — genuinely
 * `unverified: true`, same seeding discipline as every other inferred
 * candidate in this file, structurally blocked from going live until a
 * field expert confirms Kenya's actual expected cadence.
 * `seriousnessClass: 'periodic'` is a sentinel, not a real seriousness
 * tier — `ReportingRule.seriousnessClass` is a plain string column
 * precisely so a non-seriousness-scoped rule like this one can still use
 * the same `(authorityId, reportTypeId, seriousnessClass)` resolution
 * key without a schema change.
 */
export const KENYA_LINE_LISTING_REPORTING_RULE_CANDIDATE: ReportingRuleSeed[] = [
  {
    reportTypeKey: 'line_listing',
    seriousnessClass: 'periodic',
    windowDays: 28,
    reportingPeriodDays: 28,
    unverified: true,
    note: 'No GUD/022 citation — placeholder 4-weekly cadence within the Final doc\'s own "weekly or 4-6-weekly" framing, needs field-expert confirmation',
  },
]

/**
 * VigiCloud Stage 13 — Uganda's own reporting window, quoted directly
 * from the Final doc's own case-lifecycle table (a CEO/field-expert-call
 * synthesis, not a primary NDA guideline PDF the way Kenya's GUD/022
 * citations are) — genuinely `unverified: true` per this stage's own
 * explicit instruction ("as a new ReportingRule row, unverified: true
 * until confirmed with the field expert"), following the exact same
 * seeding discipline Kenya's own disputed candidates already established.
 * Seriousness-tier-agnostic (the source doesn't break it down further),
 * so this seeds a single `serious` row rather than guessing a
 * non-serious figure nobody quoted.
 */
export const UGANDA_ADR_REPORTING_RULE_CANDIDATES: ReportingRuleSeed[] = [
  {
    reportTypeKey: 'adr',
    seriousnessClass: 'serious',
    windowDays: 3,
    unverified: true,
    authorityCode: 'NDA',
    countryIso: 'UG',
    note: "Final doc's own case-lifecycle table (Uganda row) — not yet checked against NDA's own primary guideline, needs field-expert confirmation",
  },
]

/**
 * VigiCloud Stage 13/14 — the 24-hour clinical-trial SAE clock, per the
 * Final doc's own text and standard ICH-GCP practice (24h is the
 * near-universal SAE notification window across regulatory regimes, not
 * a disputed country-specific figure the way Uganda's ADR window above
 * is) — seeded `unverified: false`/`active`, unlike Uganda's row, since
 * this stage's own build-spec bullet doesn't call for it to be gated the
 * way Uganda's explicitly is. `authorityCode: 'ETHICS_COMMITTEE'` (not
 * PPB) is the whole point of `submissionDestination` existing — see that
 * column's own schema doc comment.
 *
 * Known, documented limitation: `windowDays: 1` computed via
 * `addWindowDays(awarenessDate, 1, 'calendar')` only produces a true
 * 24-hour deadline when `awarenessDate` itself carries real
 * time-of-day precision. `Case.awarenessDate` is `@db.Date` (date-only),
 * matching every other report type's own clock-start convention — so in
 * practice this resolves to "by the same clock time one calendar day
 * later" only when the case's awareness instant happens to be captured
 * with real precision elsewhere; on the date-only field alone, it can
 * read as up to slightly less than 48 hours of real-world slack
 * depending on time of day. Worth modelling properly (a genuine
 * timestamp-precision `awarenessDate` variant, scoped to trial SAEs)
 * before this specific deadline is relied on for real compliance —
 * flagged here rather than silently treated as exact, matching the same
 * "worth modelling properly... not urgent now" precedent the
 * device-incident follow-up-report deadline already set.
 */
export const CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES: ReportingRuleSeed[] = [
  {
    reportTypeKey: 'clinical_trial_sae',
    seriousnessClass: 'serious',
    windowDays: 1,
    unverified: false,
    authorityCode: 'ETHICS_COMMITTEE',
    submissionDestination: 'ethics_committee_and_trial_portal',
    note: 'Final doc + standard ICH-GCP 24-hour SAE notification window — reports to the Ethics Committee/trial portal, never PPB',
  },
]

/**
 * Real-usage feedback, 19 Aug 2026 — real Kenya-specific clinical-trial
 * SAE timelines surfaced from field-expert source material
 * (`vigicloud document formats/Country Specific Requirements-AE and
 * periodic reporting.xlsx`, "Clinical Trials" sheet, independently
 * corroborated by the same file's ISERC/SERU-specific table): **Fatal /
 * Life-Threatening SUSARs** get 7 calendar days (plus a follow-up report
 * due 8 further days after that), **Non-Life-Threatening SUSARs** get 15
 * calendar days — materially different from, and more specific than, the
 * generic 24-hour ICH-GCP placeholder seeded above (which this repo's own
 * `CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES` had marked
 * `unverified: false`/active despite never actually being a confirmed
 * Kenya-specific number). Deliberately **not** replacing that active
 * 24-hour rule here — flipping an already-*active* regulatory deadline
 * via a silent seed-script change is exactly the class of risk this
 * project's own established discipline warns against (see the seed
 * script's own natural-key upsert precedent, which updates a row *in
 * place* rather than appending a new version). The `fatal` tier is
 * genuinely new (no existing row for that natural key), so it's safe to
 * seed directly as an `unverified: true` candidate; the `serious` tier
 * would collide with — and silently overwrite in place — the existing
 * active 24-hour row, so that correction is deliberately **not** seeded
 * here and instead needs a human decision via the real Admin
 * Configuration Console ("Duplicate as verified"-style new draft
 * version), once a field expert confirms whether Kenya's real 15-day
 * clinical-trial-SAE number should actually supersede the generic
 * 24-hour ICH-GCP one.
 */
export const KENYA_CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES: ReportingRuleSeed[] = [
  {
    reportTypeKey: 'clinical_trial_sae',
    seriousnessClass: 'fatal',
    windowDays: 7,
    unverified: true,
    authorityCode: 'ETHICS_COMMITTEE',
    submissionDestination: 'ethics_committee_and_trial_portal',
    note: 'Fatal / Life-Threatening SUSARs: 7 calendar days initial report, per field-expert source (Country Specific Requirements xlsx) — a follow-up report is separately due within 8 further days (no schema field yet for a staged follow-up deadline, matching the device-incident precedent), needs field-expert confirmation before activation',
  },
]

/**
 * Real-usage content, 11 Sep 2026 — `vigicloud document formats/Country
 * Specific Requirements-AE and periodic reporting.xlsx`'s own Uganda,
 * Tanzania, Rwanda, and Ethiopia sheets, closing the "only Kenya has real
 * data" gap this file's own header comment (and CLAUDE.md's domain-
 * knowledge notes) had flagged since Phase 4. Every row below is seeded
 * `unverified: true` — same treatment this exact source document's own
 * already-seeded Kenya clinical-trial-SAE rows above got, since this
 * spreadsheet's ultimate primary-source pedigree (an authoritative NDA/
 * TMDA/RFDA/EFDA guideline PDF, vs. a compiled field-expert reference)
 * isn't independently confirmed the way GUD/022 is for Kenya. Only a
 * number the source states cleanly and unconditionally is seeded — a
 * vague, tiered, or "depending on X" figure (Uganda's own post-market
 * spontaneous-ADR window; Tanzania's non-serious device-incident/
 * PBRER-cadence risk-tier language) is deliberately left unseeded rather
 * than guessed at, matching this file's own established discipline for
 * Kenya's quality_complaint/medication_error/transfusion_reaction rows.
 *
 * PSUR/PBRER periodic cadence is a real, separate, currently-open
 * follow-up, not addressed by these `ReportingRule` rows at all:
 * `EurdCadenceUtil.computeNextEurdPeriod()` (Stage 18) hardcodes Kenya's
 * own 6mo×2→12mo×2→36mo/70-90-day formula for every tenant regardless of
 * country. Rwanda's own sheet states an identical formula (safe to keep
 * defaulting to). Uganda's is structurally different (a flat <10-years/
 * >10-years-on-market binary, 60-day deadline, no 6-month phase at all)
 * and Ethiopia's diverges too (6mo×2 then annual for 3 more years, not
 * 2) — both real, sourced divergences this pass does **not** yet
 * parameterize the pure cadence function for, flagged here rather than
 * silently left looking universally correct. Tanzania's own PBRER
 * cadence language is too tiered/conditional ("depending on risk tier")
 * to codify confidently either way.
 */
export const UGANDA_CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES: ReportingRuleSeed[] = [
  {
    reportTypeKey: 'clinical_trial_sae',
    seriousnessClass: 'fatal',
    windowDays: 7,
    unverified: true,
    authorityCode: 'ETHICS_COMMITTEE',
    countryIso: 'UG',
    submissionDestination: 'ethics_committee_and_trial_portal',
    note: 'Country Specific Requirements xlsx, Uganda sheet — fatal/life-threatening SUSARs reported to NDA and UNCST (or the authorized IRB/EC) within 7 calendar days of sponsor awareness; non-fatal SUSAR and non-serious-unexpected figures are too vague in the source to seed a specific number, needs field-expert confirmation before activation',
  },
]

export const TANZANIA_ADR_REPORTING_RULE_CANDIDATES: ReportingRuleSeed[] = [
  {
    reportTypeKey: 'adr',
    seriousnessClass: 'serious',
    windowDays: 15,
    unverified: true,
    authorityCode: 'TMDA',
    countryIso: 'TZ',
    note: 'Country Specific Requirements xlsx, Tanzania sheet — serious suspected ADRs, immediate submission required and no later than 15 calendar days from receipt of the minimum required information, needs field-expert confirmation before activation',
  },
]

export const TANZANIA_DEVICE_INCIDENT_REPORTING_RULE_CANDIDATES: ReportingRuleSeed[] = [
  {
    reportTypeKey: 'device_incident',
    seriousnessClass: 'serious',
    windowDays: 1,
    unverified: true,
    authorityCode: 'TMDA',
    countryIso: 'TZ',
    note: "Country Specific Requirements xlsx, Tanzania sheet — death, serious injury, or public health threat reported by phone/fax/email within 24 hours, followed by a detailed incident report within 15 calendar days (staged follow-up not separately modeled, matching Kenya's own device-incident precedent), needs field-expert confirmation before activation",
  },
  {
    reportTypeKey: 'device_incident',
    seriousnessClass: 'non_serious',
    windowDays: 30,
    unverified: true,
    authorityCode: 'TMDA',
    countryIso: 'TZ',
    note: 'Country Specific Requirements xlsx, Tanzania sheet — other adverse device events/incidents, not later than 30 calendar days from awareness, needs field-expert confirmation before activation',
  },
]

export const TANZANIA_CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES: ReportingRuleSeed[] = [
  {
    reportTypeKey: 'clinical_trial_sae',
    seriousnessClass: 'fatal',
    windowDays: 1,
    unverified: true,
    authorityCode: 'ETHICS_COMMITTEE',
    countryIso: 'TZ',
    submissionDestination: 'ethics_committee_and_trial_portal',
    note: 'Country Specific Requirements xlsx, Tanzania sheet — serious public health threat/death/life-threatening events, initial notification "within 24 to 48 hours" by phone/fax/email (seeded at the tighter 24h/1-day bound of that range, erring toward the stricter deadline); a detailed follow-up report is separately due within 7-15 further calendar days (not modeled, matching the device-incident precedent), needs field-expert confirmation before activation',
  },
]

export const RWANDA_ADR_REPORTING_RULE_CANDIDATES: ReportingRuleSeed[] = [
  {
    reportTypeKey: 'adr',
    seriousnessClass: 'serious',
    windowDays: 7,
    unverified: true,
    authorityCode: 'RFDA',
    countryIso: 'RW',
    note: 'Country Specific Requirements xlsx, Rwanda sheet — fatal and other serious local AE/ADR (grouped together, not split into a separate fatal tier) notified as soon as possible and not later than 7 calendar days; a complete report follows within 15 days if information was incomplete at 7 days (staged follow-up not separately modeled), needs field-expert confirmation before activation',
  },
  {
    reportTypeKey: 'adr',
    seriousnessClass: 'non_serious',
    windowDays: 30,
    unverified: true,
    authorityCode: 'RFDA',
    countryIso: 'RW',
    note: 'Country Specific Requirements xlsx, Rwanda sheet — local non-serious AE/ADR reports submitted within 30 calendar days, needs field-expert confirmation before activation',
  },
]

export const RWANDA_CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES: ReportingRuleSeed[] = [
  {
    reportTypeKey: 'clinical_trial_sae',
    seriousnessClass: 'serious',
    windowDays: 2,
    unverified: true,
    authorityCode: 'ETHICS_COMMITTEE',
    countryIso: 'RW',
    submissionDestination: 'ethics_committee_and_trial_portal',
    note: 'Country Specific Requirements xlsx, Rwanda sheet — initial SAE report submitted to Rwanda FDA and the Ethics Committee jointly within 48 hours of detection; a detailed follow-up (medical management/causality) is separately due within 10 days (or 5 working days per protocol, not modeled), needs field-expert confirmation before activation',
  },
]

export const ETHIOPIA_ADR_REPORTING_RULE_CANDIDATES: ReportingRuleSeed[] = [
  {
    reportTypeKey: 'adr',
    seriousnessClass: 'serious',
    windowDays: 15,
    unverified: true,
    authorityCode: 'EFDA',
    countryIso: 'ET',
    note: 'Country Specific Requirements xlsx, Ethiopia sheet — serious ADRs reported within 15 calendar days of becoming aware of the event, needs field-expert confirmation before activation',
  },
  {
    reportTypeKey: 'adr',
    seriousnessClass: 'non_serious',
    windowDays: 90,
    unverified: true,
    authorityCode: 'EFDA',
    countryIso: 'ET',
    note: 'Country Specific Requirements xlsx, Ethiopia sheet — non-serious ADRs reported within 90 calendar days, needs field-expert confirmation before activation',
  },
]

export const ETHIOPIA_CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES: ReportingRuleSeed[] = [
  {
    reportTypeKey: 'clinical_trial_sae',
    seriousnessClass: 'fatal',
    windowDays: 2,
    unverified: true,
    authorityCode: 'ETHICS_COMMITTEE',
    countryIso: 'ET',
    submissionDestination: 'ethics_committee_and_trial_portal',
    note: 'Country Specific Requirements xlsx, Ethiopia sheet — fatal and life-threatening events, initial notification to the competent authority within 48 hours, followed by a complete report within 15 calendar days (staged follow-up not separately modeled), needs field-expert confirmation before activation',
  },
]

/**
 * Each entry's `jsonSchema` is a section/field tree consumed by the FE's
 * generic form-rendering engine — this is the actual digitisation of the
 * official form, not a placeholder. "For official (PPB) use only" blocks
 * (report numbers, VigiFlow entry numbers) are deliberately excluded from
 * the *capture* schema — those are populated by the platform on
 * submission (Phase 5/6), never typed in by the reporting user.
 */
export interface FormSchemaSeed {
  reportTypeKey: string
  officialFormCode: string
  jsonSchema: Record<string, unknown>
}

const reporterSection = {
  key: 'reporter',
  label: 'Reporter Details',
  fields: [
    { key: 'initialReporterName', label: 'Name of Initial Reporter', type: 'text', required: true },
    { key: 'initialReporterCadre', label: 'Cadre/Designation', type: 'text' },
    { key: 'initialReporterMobile', label: 'Mobile No.', type: 'text' },
    { key: 'initialReporterEmail', label: 'Email', type: 'text' },
    { key: 'submitterName', label: 'Name of Person Submitting (if different)', type: 'text' },
    { key: 'submitterCadre', label: 'Cadre/Designation', type: 'text' },
  ],
}

const institutionSection = {
  key: 'institution',
  label: 'Institution Details',
  fields: [
    {
      key: 'institutionName',
      label: 'Name of Institution',
      type: 'text',
      required: true,
      sourceHint: 'facility',
    },
    { key: 'facilityCode', label: 'Facility Code', type: 'text', sourceHint: 'facility' },
    { key: 'county', label: 'County', type: 'text', sourceHint: 'facility' },
    { key: 'contactTel', label: 'Contact/Tel No.', type: 'text' },
  ],
}

export const KENYA_FORM_SCHEMAS: FormSchemaSeed[] = [
  {
    reportTypeKey: 'adr',
    officialFormCode: 'FOM001/MIP/PMS/SOP/001',
    jsonSchema: {
      sections: [
        {
          key: 'report_meta',
          label: 'Report Details',
          fields: [
            { key: 'reportTitle', label: 'Report Title', type: 'text' },
            {
              key: 'reportOn',
              label: 'The report is on',
              type: 'checkbox_group',
              options: ['suspected_adverse_drug_reaction', 'therapeutic_ineffectiveness'],
            },
            {
              key: 'reportKind',
              label: 'Report Type',
              type: 'radio',
              options: ['initial', 'follow_up'],
              required: true,
            },
            {
              key: 'productCategory',
              label: 'Product Category',
              type: 'radio',
              options: [
                'medicinal_product',
                'blood_products',
                'herbal_product',
                'cosmeceuticals',
                'other',
              ],
              required: true,
            },
          ],
        },
        institutionSection,
        {
          key: 'patient',
          label: 'Patient Information',
          fields: [
            { key: 'patientInitials', label: 'Patient Name/Initials', type: 'text' },
            { key: 'ipOpNo', label: 'IP/OP No.', type: 'text' },
            { key: 'dobOrAge', label: 'D.O.B/Age', type: 'text' },
            { key: 'gender', label: 'Gender', type: 'radio', options: ['male', 'female'] },
            {
              key: 'knownAllergy',
              label: 'Any Known Allergy',
              type: 'radio',
              options: ['no', 'yes'],
            },
            {
              key: 'allergySpecify',
              label: 'Specify Allergy',
              type: 'text',
              showIf: { knownAllergy: 'yes' },
            },
            {
              key: 'pregnancyStatus',
              label: 'Pregnancy Status',
              type: 'radio',
              options: [
                'not_applicable',
                'not_pregnant',
                'trimester_1',
                'trimester_2',
                'trimester_3',
              ],
            },
            { key: 'weightKg', label: 'Weight (kg)', type: 'number' },
            { key: 'heightCm', label: 'Height (cm)', type: 'number' },
          ],
        },
        {
          key: 'reaction',
          label: 'Suspected Adverse Reaction',
          fields: [
            { key: 'onsetDate', label: 'Date of Onset of Reaction', type: 'date', required: true },
            {
              key: 'reactionDescription',
              label: 'Brief Description of Reaction',
              type: 'textarea',
              required: true,
            },
          ],
        },
        {
          key: 'medical_history',
          label: 'Medical History',
          fields: [
            {
              key: 'medicalHistory',
              label:
                'Pre-existing conditions, allergies, smoking, alcohol, hepatic/renal dysfunction',
              type: 'textarea',
            },
          ],
        },
        {
          key: 'current_medicines',
          label: 'Current Medicines (tick the suspected drug)',
          type: 'table',
          columns: [
            'suspected',
            'innGenericName',
            'brandName',
            'batchLotNo',
            'manufacturer',
            'dose',
            'route',
            'frequency',
            'startDate',
            'stopDate',
            'indication',
          ],
        },
        {
          key: 'past_medication_history',
          label: 'Past Medication History (last 3 months)',
          type: 'table',
          columns: [
            'innGenericName',
            'brandName',
            'batchLotNo',
            'manufacturer',
            'dose',
            'route',
            'frequency',
            'startDate',
            'stopDate',
            'indication',
          ],
        },
        {
          key: 'dechallenge_rechallenge',
          label: 'Dechallenge/Rechallenge',
          fields: [
            {
              key: 'resolvedAfterStop',
              label: 'Reaction resolved after drug stopped/dose reduced?',
              type: 'radio',
              options: ['yes', 'no', 'unknown', 'not_applicable'],
            },
            {
              key: 'reappearedAfterReintroduce',
              label: 'Reaction reappeared after reintroduction?',
              type: 'radio',
              options: ['yes', 'no', 'unknown', 'not_applicable'],
            },
          ],
        },
        {
          key: 'lab_investigations',
          label: 'Lab Investigations and Results',
          fields: [{ key: 'labResults', label: 'Results', type: 'textarea' }],
        },
        {
          key: 'grading',
          label: 'Grading of the Reaction/Event',
          fields: [
            {
              key: 'severity',
              label: 'Severity of Reaction',
              type: 'radio',
              options: ['mild', 'moderate', 'severe', 'fatal', 'unknown'],
              required: true,
            },
            {
              key: 'isSerious',
              label: 'Is the Reaction Serious?',
              type: 'radio',
              options: ['yes', 'no'],
              required: true,
            },
            {
              key: 'seriousnessCriteria',
              label: 'Criteria/Reason for Seriousness',
              type: 'checkbox_group',
              options: [
                'hospitalization',
                'disability',
                'congenital_anomaly',
                'life_threatening',
                'death',
              ],
              showIf: { isSerious: 'yes' },
              sourceHint: 'seriousness_definition',
            },
            {
              key: 'actionTaken',
              label: 'Action Taken',
              type: 'radio',
              options: [
                'drug_withdrawn',
                'dose_reduced',
                'dose_increased',
                'dose_not_changed',
                'not_applicable',
                'unknown',
              ],
            },
            {
              key: 'outcome',
              label: 'Outcome',
              type: 'radio',
              options: [
                'recovered',
                'recovered_with_sequelae',
                'recovering',
                'not_recovered',
                'death',
                'unknown',
              ],
              required: true,
            },
          ],
        },
        {
          key: 'other_comment',
          label: 'Any Other Comment',
          fields: [{ key: 'comment', label: 'Comment', type: 'textarea' }],
        },
        reporterSection,
      ],
    },
  },
  {
    reportTypeKey: 'quality_complaint',
    officialFormCode: 'FOM001/MIP/PMS/SOP/001',
    jsonSchema: {
      sections: [
        {
          key: 'product_category',
          label: 'Product Category',
          fields: [
            {
              key: 'productCategory',
              label: 'Product Category',
              type: 'radio',
              options: [
                'medicinal_product',
                'herbal_product',
                'vaccine',
                'blood_products',
                'medical_device_ivd',
                'cosmeceuticals',
                'other',
              ],
              required: true,
            },
          ],
        },
        institutionSection,
        {
          key: 'product_identity',
          label: 'Product Identity',
          fields: [
            { key: 'brandName', label: 'Brand Name', type: 'text', required: true },
            { key: 'genericName', label: 'Generic Name', type: 'text' },
            {
              key: 'batchLotNo',
              label: 'Batch/Lot Number / Unique Identifier',
              type: 'text',
              required: true,
            },
            { key: 'manufactureDate', label: 'Date of Manufacture', type: 'date' },
            { key: 'expiryDate', label: 'Date of Expiry', type: 'date' },
            { key: 'receiptDate', label: 'Date of Receipt', type: 'date' },
            { key: 'manufacturerName', label: 'Name of Manufacturer', type: 'text' },
            { key: 'manufacturerAddress', label: 'Manufacturer Address', type: 'text' },
            { key: 'countryOfOrigin', label: 'Country of Origin', type: 'text' },
            { key: 'distributorName', label: 'Name of Distributor/Supplier', type: 'text' },
            { key: 'distributorAddress', label: "Distributor/Supplier's Address", type: 'text' },
            { key: 'distributorTelephone', label: 'Telephone', type: 'text' },
          ],
        },
        {
          key: 'formulation',
          label: 'Product Formulation',
          fields: [
            {
              key: 'formulation',
              label: 'Formulation',
              type: 'radio',
              options: [
                'oral_tablets_capsules',
                'oral_suspension_syrup',
                'injection',
                'diluent',
                'powder_for_reconstitution_injection',
                'powder_for_reconstitution_suspension',
                'eye_drops',
                'ear_drops',
                'nebulizer_solution',
                'cream_ointment_liniment_paste',
                'other',
              ],
            },
          ],
        },
        {
          key: 'complaint',
          label: 'Complaint',
          fields: [
            {
              key: 'complaintTypes',
              label: 'Complaint',
              type: 'checkbox_group',
              options: [
                'color_change',
                'moulding',
                'separating',
                'change_of_odour',
                'powdering_crumbling',
                'mislabeling',
                'caking',
                'incomplete_pack',
                'therapeutic_ineffectiveness',
                'other',
              ],
            },
            {
              key: 'deviceComplaintTypes',
              label: 'For Medical Device/IVD Complaint',
              type: 'checkbox_group',
              options: [
                'packaging',
                'labelling',
                'sampling',
                'mechanism',
                'electrical',
                'data',
                'software',
                'environmental',
                'failure_to_calibrate',
                'results',
                'readings',
              ],
              showIf: { productCategory: 'medical_device_ivd' },
            },
            {
              key: 'complaintDetail',
              label: 'Describe Complaint in Detail',
              type: 'textarea',
              required: true,
            },
          ],
        },
        {
          key: 'storage',
          label: 'Storage Conditions',
          fields: [
            {
              key: 'coldChainMaintained',
              label: 'Was the cold chain maintained (transport and storage)?',
              type: 'textarea',
            },
            {
              key: 'requiresRefrigeration',
              label: 'Does the product require refrigeration?',
              type: 'radio',
              options: ['yes', 'no'],
            },
            {
              key: 'availableAtFacility',
              label: 'Was product available at facility?',
              type: 'radio',
              options: ['yes', 'no'],
            },
            {
              key: 'dispensedAndReturned',
              label: 'Was product dispensed and returned by client?',
              type: 'radio',
              options: ['yes', 'no'],
            },
            {
              key: 'storedPerRecommendations',
              label: 'Was product stored per manufacturer/MoH recommendations?',
              type: 'radio',
              options: ['yes', 'no'],
            },
          ],
        },
        reporterSection,
      ],
    },
  },
  {
    reportTypeKey: 'medication_error',
    officialFormCode: 'FOM21/MIP/PMS/SOP/001',
    jsonSchema: {
      sections: [
        {
          key: 'event_meta',
          label: 'Event Details',
          fields: [
            { key: 'eventDate', label: 'Date of Event', type: 'date', required: true },
            { key: 'eventTime', label: 'Time of Event', type: 'time' },
          ],
        },
        institutionSection,
        {
          key: 'patient',
          label: 'Patient Information',
          fields: [
            { key: 'patientInitials', label: 'Patient Initials', type: 'text' },
            { key: 'dobOrAge', label: 'D.O.B/Age', type: 'text' },
            { key: 'gender', label: 'Gender', type: 'radio', options: ['male', 'female'] },
          ],
        },
        {
          key: 'error_details',
          label: 'Details on the Medication Error',
          fields: [
            {
              key: 'locationOfEvent',
              label: 'Location of Event',
              type: 'radio',
              options: ['ward', 'clinic', 'pharmacy', 'accident_emergency', 'other'],
            },
            {
              key: 'errorDescription',
              label: 'Describe the error, sequence of events, work environment',
              type: 'textarea',
              required: true,
            },
            {
              key: 'errorProcess',
              label: 'In which process did the error occur?',
              type: 'radio',
              options: ['prescribing', 'dispensing', 'administration', 'other'],
            },
            {
              key: 'errorReachedPatient',
              label: 'Did the error reach the patient?',
              type: 'radio',
              options: ['yes', 'no'],
            },
            {
              key: 'correctMedicationGiven',
              label: 'Was the correct medication/dose/form administered?',
              type: 'radio',
              options: ['yes', 'no'],
            },
            {
              key: 'directResultOnPatient',
              label: 'Describe the direct result on the patient',
              type: 'textarea',
            },
          ],
        },
        {
          key: 'outcome_category',
          label: 'Error Outcome Category',
          fields: [
            {
              key: 'outcomeCategory',
              label: 'Outcome Category',
              type: 'radio',
              options: [
                'potential_error',
                'actual_error_no_harm',
                'treatment_required_temporary_harm',
                'additional_monitoring_no_harm',
                'hospitalization_temporary_harm',
                'permanent_harm',
                'near_death',
                'death',
              ],
              required: true,
            },
          ],
        },
        {
          key: 'cause_factors',
          label: 'Possible Cause(s) and Contributing Factor(s)',
          fields: [
            {
              key: 'causeFactors',
              label: 'Cause/Contributing Factors',
              type: 'checkbox_group',
              options: [
                'inexperienced_personnel',
                'inadequate_knowledge',
                'distraction',
                'sound_alike_medication',
                'look_alike_medication',
                'look_alike_packaging',
                'heavy_workload',
                'peak_hour',
                'stock_arrangement_problem',
                'failure_to_adhere_to_procedure',
                'use_of_abbreviations',
                'illegible_prescriptions',
                'patient_record_unavailable',
                'wrong_labelling_instruction',
                'incorrect_computer_entry',
                'other',
              ],
            },
          ],
        },
        {
          key: 'product_details',
          label: 'Product Details (intended vs. error)',
          type: 'table',
          columns: [
            'genericName',
            'brandName',
            'dosageForm',
            'doseFrequencyDurationRoute',
            'manufacturer',
            'strength',
            'containerType',
          ],
          rowLabels: ['intended', 'error'],
        },
        {
          key: 'recommendations',
          label: 'Recommendations / Preventive Actions',
          fields: [
            {
              key: 'recommendations',
              label: 'Recommendations, policies, or RCA summary',
              type: 'textarea',
            },
          ],
        },
        reporterSection,
      ],
    },
  },
  {
    reportTypeKey: 'device_incident',
    officialFormCode: 'FOM019/MIP/PMS/SOP/001',
    jsonSchema: {
      sections: [
        {
          key: 'report_meta',
          label: 'Report Details',
          fields: [
            {
              key: 'reportKind',
              label: 'Report Type',
              type: 'radio',
              options: ['initial', 'follow_up'],
              required: true,
            },
            { key: 'reportTitle', label: 'Report Title', type: 'text' },
          ],
        },
        institutionSection,
        {
          key: 'patient',
          label: 'Patient Information',
          fields: [
            { key: 'patientInitials', label: 'Patient Name/Initials', type: 'text' },
            { key: 'dobOrAge', label: 'D.O.B/Age', type: 'text' },
            { key: 'gender', label: 'Gender', type: 'radio', options: ['male', 'female'] },
            {
              key: 'knownAllergy',
              label: 'Any Known Allergy',
              type: 'radio',
              options: ['no', 'yes'],
            },
            {
              key: 'pregnancyStatus',
              label: 'Pregnancy Status',
              type: 'radio',
              options: [
                'not_applicable',
                'not_pregnant',
                'trimester_1',
                'trimester_2',
                'trimester_3',
              ],
            },
          ],
        },
        {
          key: 'device_info',
          label: 'Device/In Vitro Diagnostic Information',
          fields: [
            {
              key: 'problemNotedPriorToUse',
              label: 'Problem noted prior to use?',
              type: 'radio',
              options: ['yes', 'no'],
            },
            { key: 'brandName', label: 'Brand Name/Commercial Name', type: 'text', required: true },
            { key: 'serialLotNo', label: 'Serial/Lot No.', type: 'text' },
            {
              key: 'commonName',
              label: 'Common Name (e.g. catheter, syringe, gloves)',
              type: 'text',
            },
            { key: 'model', label: 'Model', type: 'text' },
            { key: 'catalogue', label: 'Catalogue', type: 'text' },
            { key: 'manufacturerName', label: 'Name of Manufacturer', type: 'text' },
            { key: 'manufacturerAddress', label: 'Address of Manufacturer', type: 'text' },
            { key: 'manufactureDate', label: 'Device Manufacture Date', type: 'date' },
            { key: 'expiryDate', label: 'Expiry Date', type: 'date' },
            {
              key: 'operator',
              label: 'Operator of the Device at Time of Onset',
              type: 'radio',
              options: ['healthcare_professional', 'patient', 'caregiver', 'other'],
            },
            {
              key: 'usage',
              label: 'Usage of Device',
              type: 'radio',
              options: [
                'single_use',
                'reuse_of_reusable',
                'reuse_of_single_use',
                'reserviced_refurbished',
              ],
            },
            { key: 'durationInUse', label: 'How long was the device in use', type: 'text' },
            {
              key: 'availableForEvaluation',
              label: 'Availability of device for evaluation',
              type: 'radio',
              options: ['yes', 'no'],
            },
          ],
        },
        {
          key: 'implant',
          label: 'For Implants Only',
          fields: [
            { key: 'implantDate', label: 'Implant Date', type: 'date' },
            { key: 'explantDate', label: 'Explant Date', type: 'date' },
          ],
        },
        {
          key: 'diagnostics',
          label: 'For Diagnostics Only',
          fields: [
            { key: 'specimenType', label: 'Type of Specimen Used', type: 'text' },
            { key: 'patientsInvolved', label: 'No. of Patients Involved', type: 'number' },
            { key: 'testsDone', label: 'No. of Tests Done', type: 'number' },
            { key: 'falsePositives', label: 'No. of False Positives', type: 'number' },
            { key: 'falseNegatives', label: 'No. of False Negatives', type: 'number' },
            { key: 'truePositives', label: 'No. of True Positives', type: 'number' },
            { key: 'trueNegatives', label: 'No. of True Negatives', type: 'number' },
          ],
        },
        {
          key: 'incident',
          label: 'Incident Information',
          fields: [
            {
              key: 'onsetDate',
              label: 'Date of Onset of the Incident',
              type: 'date',
              required: true,
            },
            {
              key: 'classification',
              label: 'Event Classification',
              type: 'radio',
              options: ['fatal', 'serious', 'moderate', 'mild', 'unknown'],
              required: true,
            },
            {
              key: 'seriousnessReasons',
              label: 'Reason for Seriousness',
              type: 'checkbox_group',
              options: [
                'death',
                'life_threatening',
                'hospitalization',
                'persistent_significant_disability',
                'congenital_anomaly',
              ],
              sourceHint: 'seriousness_definition',
            },
            {
              key: 'eventDescription',
              label: 'Description of Event',
              type: 'textarea',
              required: true,
            },
            {
              key: 'remedialAction',
              label: 'Remedial/Corrective/Preventive Action',
              type: 'textarea',
            },
            {
              key: 'patientOutcome',
              label: 'Patient Outcome',
              type: 'radio',
              options: [
                'recovering',
                'not_recovered',
                'fatal',
                'recovered',
                'recovered_with_sequelae',
                'unknown',
              ],
            },
          ],
        },
        reporterSection,
      ],
    },
  },
  {
    reportTypeKey: 'aefi',
    officialFormCode: 'AEFI Reporting Form (MoH NVIP)',
    jsonSchema: {
      sections: [
        {
          key: 'report_meta',
          label: 'Report Details',
          fields: [
            {
              key: 'reportKind',
              label: 'Report Type',
              type: 'radio',
              options: ['initial', 'follow_up'],
              required: true,
            },
          ],
        },
        institutionSection,
        {
          key: 'patient',
          label: 'Patient Details',
          fields: [
            { key: 'patientName', label: "Patient's Name", type: 'text', required: true },
            { key: 'gender', label: 'Gender', type: 'radio', options: ['male', 'female'] },
            {
              key: 'guardianName',
              label: 'Name of Guardian (if patient is a child)',
              type: 'text',
            },
            { key: 'dobOrAge', label: 'Date of Birth (or age)', type: 'text' },
            { key: 'address', label: 'Address', type: 'text' },
            { key: 'phoneNumber', label: 'Phone Number', type: 'text' },
            { key: 'village', label: 'Village', type: 'text' },
            { key: 'ward', label: 'Ward', type: 'text' },
            { key: 'vaccinationCentre', label: 'Vaccination Centre', type: 'text' },
            {
              key: 'vaccinationServiceType',
              label: 'Type of Vaccination Service',
              type: 'radio',
              options: ['static', 'mass', 'outreach'],
            },
          ],
        },
        {
          key: 'aefi_type',
          label: 'Type of AEFI',
          fields: [
            {
              key: 'aefiTypes',
              label: 'AEFI Type',
              type: 'checkbox_group',
              options: [
                'bcg_lymphadenitis',
                'anaphylaxis',
                'convulsion',
                'encephalopathy_encephalitis_meningitis',
                'generalized_urticaria',
                'paralysis',
                'high_fever',
                'toxic_shock',
                'injection_site_abscess',
                'severe_local_reaction',
                'other',
              ],
              required: true,
            },
            {
              key: 'eventDetail',
              label: 'Brief Details on the Event (incl. timeline)',
              type: 'textarea',
              required: true,
            },
            { key: 'onsetDate', label: 'Onset of Event — Date', type: 'date', required: true },
            { key: 'onsetTime', label: 'Onset of Event — Time', type: 'time' },
          ],
        },
        {
          key: 'suspected_vaccines',
          label: 'Suspected Vaccine(s)',
          type: 'table',
          columns: [
            'vaccineName',
            'doseNo',
            'dateVaccinated',
            'timeVaccinated',
            'routeSite',
            'vaccineLotNo',
            'vaccineManufacturer',
            'vaccineExpiryDate',
            'diluentLotNo',
            'diluentManufacturer',
            'diluentExpiryDate',
          ],
        },
        {
          key: 'history',
          label: 'Past Medical History',
          fields: [
            {
              key: 'pastMedicalHistory',
              label:
                'History of similar reaction, allergies, concomitant medication/illness, pregnancy status',
              type: 'textarea',
            },
          ],
        },
        {
          key: 'action_outcome',
          label: 'Action Taken and Outcome',
          fields: [
            { key: 'treatmentGiven', label: 'Treatment Given', type: 'textarea' },
            {
              key: 'specimenCollected',
              label: 'Specimen Collected for Investigation',
              type: 'text',
            },
            {
              key: 'aefiOutcome',
              label: 'AEFI Outcome',
              type: 'radio',
              options: ['recovered', 'recovering', 'not_recovered', 'unknown', 'died'],
              required: true,
            },
          ],
        },
        reporterSection,
      ],
    },
  },
  {
    reportTypeKey: 'transfusion_reaction',
    officialFormCode: 'FOM20/MIP/PMS/SOP/001',
    jsonSchema: {
      sections: [
        {
          key: 'patient',
          label: 'Patient Information',
          fields: [
            { key: 'patientName', label: 'Patient Name', type: 'text', required: true },
            { key: 'age', label: 'Age', type: 'text' },
            { key: 'gender', label: 'Gender', type: 'radio', options: ['male', 'female'] },
            { key: 'patientNo', label: 'Patient No.', type: 'text' },
            { key: 'diagnosis', label: 'Diagnosis', type: 'text' },
            { key: 'ward', label: 'Ward', type: 'text' },
            { key: 'preTransfusionHb', label: 'Pre-transfusion HB', type: 'text' },
            { key: 'reasonForTransfusion', label: 'Reason for Transfusion', type: 'text' },
            { key: 'currentMedications', label: 'Current Medications', type: 'text' },
            {
              key: 'obstetricHistory',
              label: 'Obstetric History',
              type: 'radio',
              options: ['not_applicable', 'gravid', 'para'],
            },
            {
              key: 'previousTransfusion',
              label: 'Previous Transfusion',
              type: 'radio',
              options: ['yes', 'no'],
            },
            {
              key: 'previousReactions',
              label: 'Previous Reactions',
              type: 'radio',
              options: ['yes', 'no'],
            },
          ],
        },
        {
          key: 'reaction',
          label: 'Type of Reaction',
          fields: [
            {
              key: 'reactionTypes',
              label: 'Type of Reaction',
              type: 'checkbox_group',
              options: [
                'fever',
                'chills_rigors',
                'flushing',
                'nausea_vomiting',
                'urticaria',
                'other_skin_rash',
                'chest_pain',
                'dyspnoea',
                'hypotension',
                'tachycardia',
                'haemoglobinuria_dark_urine',
                'oliguria',
                'anuria',
                'unexplained_bleeding',
                'other',
              ],
            },
          ],
        },
        {
          key: 'component',
          label: 'Component Information',
          type: 'table',
          columns: ['componentType', 'pintNo', 'expiryDate', 'volumeTransfused'],
        },
        {
          key: 'lab_investigation',
          label: 'Lab Investigation (Transfusion Manager)',
          fields: [
            {
              key: 'recipientHemolysis',
              label: "Recipient's Blood Supernatant — Hemolysis",
              type: 'radio',
              options: ['present', 'absent', 'equivocal'],
            },
            {
              key: 'recipientAgglutination',
              label: "Recipient's Blood — Agglutination",
              type: 'radio',
              options: ['present', 'absent'],
            },
            {
              key: 'donorHemolysis',
              label: 'Donor Blood Supernatant — Hemolysis',
              type: 'radio',
              options: ['present', 'absent'],
            },
            {
              key: 'compatibilityResult',
              label: 'Compatibility Testing Result',
              type: 'radio',
              options: ['compatible', 'incompatible'],
            },
            { key: 'urinalysis', label: 'Urinalysis', type: 'text' },
            { key: 'evaluationDiagnosis', label: 'Evaluation: Diagnosis', type: 'textarea' },
            {
              key: 'wasReactionRelatedToTransfusion',
              label: 'Was the adverse reaction related to transfusion?',
              type: 'radio',
              options: ['yes', 'no', 'inconclusive'],
              required: true,
            },
          ],
        },
        reporterSection,
      ],
    },
  },
]

export interface SubmissionFormatSeed {
  reportTypeKey: string
  authorityCode: 'PPB' | 'NVIP'
  channel: 'vigiflow' | 'dhis2'
  templateRef: string
}

export const KENYA_SUBMISSION_FORMATS: SubmissionFormatSeed[] = [
  {
    reportTypeKey: 'adr',
    authorityCode: 'PPB',
    channel: 'vigiflow',
    templateRef: 'ppb.vigiflow.icsr.v1',
  },
  {
    reportTypeKey: 'quality_complaint',
    authorityCode: 'PPB',
    channel: 'vigiflow',
    templateRef: 'ppb.vigiflow.quality_complaint.v1',
  },
  {
    reportTypeKey: 'medication_error',
    authorityCode: 'PPB',
    channel: 'vigiflow',
    templateRef: 'ppb.vigiflow.medication_error.v1',
  },
  {
    reportTypeKey: 'device_incident',
    authorityCode: 'PPB',
    channel: 'vigiflow',
    templateRef: 'ppb.vigiflow.device_incident.v1',
  },
  {
    reportTypeKey: 'transfusion_reaction',
    authorityCode: 'PPB',
    channel: 'vigiflow',
    templateRef: 'ppb.vigiflow.transfusion_reaction.v1',
  },
  {
    reportTypeKey: 'aefi',
    authorityCode: 'NVIP',
    channel: 'dhis2',
    templateRef: 'nvip.dhis2.aefi.v1',
  },
]
