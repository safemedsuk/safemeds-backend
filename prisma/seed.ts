import { Prisma, PrismaClient } from '@prisma/client'
import * as argon2 from 'argon2'

import { newId } from '../src/common/id'
import { AUDIT_REQUIREMENTS } from './audit-requirements.seed-data'
import { COUNTRIES } from './countries.seed-data'
import {
  AUTHORITIES,
  CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES,
  ETHIOPIA_ADR_REPORTING_RULE_CANDIDATES,
  ETHIOPIA_CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES,
  KENYA_ADR_REPORTING_RULE_CANDIDATES,
  KENYA_CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES,
  KENYA_DEVICE_INCIDENT_REPORTING_RULES,
  KENYA_FORM_SCHEMAS,
  KENYA_LINE_LISTING_REPORTING_RULE_CANDIDATE,
  KENYA_SERIOUSNESS_CRITERIA,
  KENYA_SUBMISSION_FORMATS,
  KENYA_UNVERIFIED_REPORTING_RULE_CANDIDATES,
  REPORT_TYPES,
  RWANDA_ADR_REPORTING_RULE_CANDIDATES,
  RWANDA_CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES,
  TANZANIA_ADR_REPORTING_RULE_CANDIDATES,
  TANZANIA_CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES,
  TANZANIA_DEVICE_INCIDENT_REPORTING_RULE_CANDIDATES,
  UGANDA_ADR_REPORTING_RULE_CANDIDATES,
  UGANDA_CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES,
} from './country-rules.seed-data'
import { INSPECTION_CHECKLIST_SECTIONS } from './inspection-checklist.seed-data'
import { MEDDRA_SOCS, MEDDRA_VERSION_LABEL, MEDDRA_VERSION_RELEASED_ON } from './meddra.seed-data'
import { PERMISSIONS, ROLES } from './rbac.seed-data'
import { RECALL_RULE_SETS } from './recall-rules.seed-data'
import {
  WHO_DRUG_TERMS,
  WHO_DRUG_VERSION_LABEL,
  WHO_DRUG_VERSION_RELEASED_ON,
} from './who-drug.seed-data'
import {
  PERIODIC_REPORT_WORKFLOW_RECORD_TYPE,
  PERIODIC_REPORT_WORKFLOW_STATES,
  PERIODIC_REPORT_WORKFLOW_TRANSITIONS,
  PROMOTIONAL_MATERIAL_WORKFLOW_RECORD_TYPE,
  PROMOTIONAL_MATERIAL_WORKFLOW_STATES,
  PROMOTIONAL_MATERIAL_WORKFLOW_TRANSITIONS,
  PV_CASE_WORKFLOW_RECORD_TYPE,
  PV_CASE_WORKFLOW_STATES,
  PV_CASE_WORKFLOW_TRANSITIONS,
  QUALITY_CHANGE_CONTROL_WORKFLOW_RECORD_TYPE,
  QUALITY_CHANGE_CONTROL_WORKFLOW_STATES,
  QUALITY_CHANGE_CONTROL_WORKFLOW_TRANSITIONS,
  QUALITY_COMPLAINT_WORKFLOW_RECORD_TYPE,
  QUALITY_COMPLAINT_WORKFLOW_STATES,
  QUALITY_COMPLAINT_WORKFLOW_TRANSITIONS,
  QUALITY_CONTROLLED_DOCUMENT_WORKFLOW_RECORD_TYPE,
  QUALITY_CONTROLLED_DOCUMENT_WORKFLOW_STATES,
  QUALITY_CONTROLLED_DOCUMENT_WORKFLOW_TRANSITIONS,
  QUALITY_DEVIATION_WORKFLOW_RECORD_TYPE,
  QUALITY_DEVIATION_WORKFLOW_STATES,
  QUALITY_DEVIATION_WORKFLOW_TRANSITIONS,
  QUALITY_OOS_WORKFLOW_RECORD_TYPE,
  QUALITY_OOS_WORKFLOW_STATES,
  QUALITY_OOS_WORKFLOW_TRANSITIONS,
  RECALL_WORKFLOW_RECORD_TYPE,
  RECALL_WORKFLOW_STATES,
  RECALL_WORKFLOW_TRANSITIONS,
  REG_REGISTRATION_WORKFLOW_RECORD_TYPE,
  REG_REGISTRATION_WORKFLOW_STATES,
  REG_REGISTRATION_WORKFLOW_TRANSITIONS,
  SIGNAL_WORKFLOW_RECORD_TYPE,
  SIGNAL_WORKFLOW_STATES,
  SIGNAL_WORKFLOW_TRANSITIONS,
} from './workflow.seed-data'

const prisma = new PrismaClient()

const DEMO_PLATFORM_ADMIN_EMAIL = 'platform.admin@safemeds.internal'
const DEMO_PLATFORM_ADMIN_PASSWORD = 'SafeMeds!Admin2026'

async function seedCountries(): Promise<void> {
  for (const country of COUNTRIES) {
    await prisma.country.upsert({
      where: { isoCode: country.isoCode },
      update: { name: country.name, officialName: country.officialName ?? null },
      create: {
        id: newId(),
        isoCode: country.isoCode,
        name: country.name,
        officialName: country.officialName ?? null,
      },
    })
  }
  console.log(`Seeded ${COUNTRIES.length} countries.`)
}

async function seedDemoPlatformAdmin(): Promise<void> {
  const passwordHash = await argon2.hash(DEMO_PLATFORM_ADMIN_PASSWORD, { type: argon2.argon2id })

  // `app_user` has RLS FORCED (Phase 2.3) — a seed script is a trusted,
  // operator-run, one-off bootstrap, not a real request, so it sets the
  // same bypass flag `RlsService.runWithSystemAccess` uses, scoped to
  // this one transaction (`set_config(..., true)` = SET LOCAL semantics).
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
    await tx.user.upsert({
      where: { email: DEMO_PLATFORM_ADMIN_EMAIL },
      update: {},
      create: {
        id: newId(),
        email: DEMO_PLATFORM_ADMIN_EMAIL,
        fullName: 'SafeMeds Platform Admin (demo)',
        passwordHash,
        platformRole: 'super_admin',
        roleKeys: [],
      },
    })
  })

  console.log(`Seeded demo platform admin: ${DEMO_PLATFORM_ADMIN_EMAIL}`)
}

async function seedRolesAndPermissions(): Promise<void> {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: { id: newId(), key: permission.key, description: permission.description },
    })
  }

  for (const role of ROLES) {
    const roleRow = await prisma.role.upsert({
      where: { key: role.key },
      update: { name: role.name, description: role.description, isPlatform: role.isPlatform },
      create: {
        id: newId(),
        key: role.key,
        name: role.name,
        description: role.description,
        isPlatform: role.isPlatform,
      },
    })

    // Re-derive this role's permission set from scratch each run so a
    // permission removed from rbac.seed-data.ts actually gets revoked,
    // not just left stale from a previous seed.
    await prisma.rolePermission.deleteMany({ where: { roleId: roleRow.id } })

    const permissionRows = await prisma.permission.findMany({
      where: { key: { in: role.permissions } },
    })
    if (permissionRows.length !== role.permissions.length) {
      const found = new Set(permissionRows.map((p) => p.key))
      const missing = role.permissions.filter((key) => !found.has(key))
      throw new Error(
        `Role "${role.key}" references unknown permission key(s): ${missing.join(', ')}`,
      )
    }

    await prisma.rolePermission.createMany({
      data: permissionRows.map((permission) => ({
        roleId: roleRow.id,
        permissionId: permission.id,
      })),
    })
  }

  console.log(`Seeded ${PERMISSIONS.length} permissions across ${ROLES.length} roles.`)
}

async function seedCountryRulesEngine(): Promise<void> {
  const countries = await prisma.country.findMany({
    where: { isoCode: { in: AUTHORITIES.map((a) => a.countryIso) } },
  })
  const countryIdByIso = new Map(countries.map((c) => [c.isoCode, c.id]))

  const authorityRows: { id: string; code: string; countryIso: string }[] = []
  for (const authority of AUTHORITIES) {
    const countryId = countryIdByIso.get(authority.countryIso)
    if (!countryId)
      throw new Error(`Unknown country ISO "${authority.countryIso}" in AUTHORITIES seed`)

    const letterhead = {
      formCode: authority.formCode ?? null,
      ministryName: authority.ministryName ?? null,
      poBoxAddress: authority.poBoxAddress ?? null,
      phone: authority.phone ?? null,
      contactEmail: authority.contactEmail ?? null,
      emblemAssetKey: authority.emblemAssetKey ?? null,
    }
    const row = await prisma.regulatoryAuthority.upsert({
      where: { countryId_code: { countryId, code: authority.code } },
      update: { name: authority.name, ...letterhead },
      create: { id: newId(), countryId, code: authority.code, name: authority.name, ...letterhead },
    })
    authorityRows.push({ id: row.id, code: row.code, countryIso: authority.countryIso })
  }

  // An authority's `code` occasionally changes for real (e.g. Tanzania's
  // TFDA -> TMDA rename, 2019) — `upsert` is keyed on (countryId, code), so
  // a code change creates a fresh row rather than renaming the old one,
  // leaving the retired code's row orphaned. Self-heal by deleting any
  // authority row, per seeded country, whose code isn't in today's
  // AUTHORITIES list for that country — but only if it's genuinely
  // orphaned. Found 22 Sep 2026, same bug class this file already
  // documents twice over (the reporting-rule block, the workflow-
  // definition block): the old comment here *claimed* "isn't referenced
  // by anything" without ever actually checking, and a blanket
  // `deleteMany` threw a real FK violation the moment a non-static
  // authority (e.g. one created live through the admin "Bring a New
  // Country Online" console) or a real `RegDossier`/`ReportingRule`/etc.
  // row referenced it. `RegulatoryAuthority` has 17 separate FK
  // relations pointing at it — rather than enumerate and count every one,
  // delete row-by-row and treat a foreign-key violation (P2003) as "still
  // referenced, leave it," with a loud warning instead of silence.
  for (const countryId of new Set(countryIdByIso.values())) {
    const expectedCodes = AUTHORITIES.filter(
      (a) => countryIdByIso.get(a.countryIso) === countryId,
    ).map((a) => a.code)
    const candidates = await prisma.regulatoryAuthority.findMany({
      where: { countryId, code: { notIn: expectedCodes } },
      select: { id: true, code: true },
    })
    for (const candidate of candidates) {
      try {
        await prisma.regulatoryAuthority.delete({ where: { id: candidate.id } })
      } catch (err) {
        if ((err as { code?: string }).code === 'P2003') {
          console.warn(
            `Skipped deleting orphan-looking RegulatoryAuthority "${candidate.code}" (${candidate.id}) — still referenced by real data.`,
          )
        } else {
          throw err
        }
      }
    }
  }

  for (const reportType of REPORT_TYPES) {
    await prisma.reportType.upsert({
      where: { typeKey: reportType.typeKey },
      update: { name: reportType.name, moduleKey: reportType.moduleKey },
      create: {
        id: newId(),
        typeKey: reportType.typeKey,
        name: reportType.name,
        moduleKey: reportType.moduleKey,
      },
    })
  }

  const reportTypeRows = await prisma.reportType.findMany()
  const reportTypeIdByKey = new Map(reportTypeRows.map((r) => [r.typeKey, r.id]))
  // Keyed by `${countryIso}::${code}`, not bare `code` — `ETHICS_COMMITTEE`
  // (Stage 13, Kenya-only originally) stopped being a globally-unique
  // authority code the moment Uganda/Tanzania/Rwanda/Ethiopia each got
  // their own synthetic Ethics-Committee row (11 Sep 2026); a bare-`code`
  // map would silently collapse all five into whichever one happened to
  // be inserted last, misattributing every `ReportingRuleSeed` candidate
  // that targets `authorityCode: 'ETHICS_COMMITTEE'` (including Kenya's
  // own pre-existing clinical-trial-SAE rules) to the wrong country's row
  // — caught immediately via a direct DB check before this ever reached
  // a real seed run anyone relied on.
  const authorityKey = (countryIso: string, code: string) => `${countryIso}::${code}`
  const authorityIdByCode = new Map(
    authorityRows.map((a) => [authorityKey(a.countryIso, a.code), a.id]),
  )
  const ppbId = authorityIdByCode.get(authorityKey('KE', 'PPB'))!
  const nvipId = authorityIdByCode.get(authorityKey('KE', 'NVIP'))!

  // Seriousness definitions — confirmed against FOM001 §8.III. Re-derived
  // from scratch each run, same pattern as seedRolesAndPermissions.
  await prisma.seriousnessDefinition.deleteMany({ where: { authorityId: ppbId } })
  await prisma.seriousnessDefinition.createMany({
    data: KENYA_SERIOUSNESS_CRITERIA.map((c) => ({
      id: newId(),
      authorityId: ppbId,
      criterionKey: c.criterionKey,
      label: c.label,
      version: 1,
      status: 'active' as const,
      effectiveFrom: new Date('2026-01-01'),
    })),
  })

  // Reporting rules — ADR (§6.1, confirmed) + device incidents (§6.5.1,
  // confirmed, materially different tiering) + quality/medication-error/
  // transfusion-reaction (unverified, inferred by analogy — see Q1 in
  // docs/safemeds-domain-knowledge.md) + VigiCloud Stage 13's Uganda ADR
  // candidate (unverified, its own authority — NDA) and clinical-trial
  // SAE rule (its own authority — the synthetic ETHICS_COMMITTEE row,
  // confirmed/active). Each row's own `unverified` flag decides whether
  // it seeds as a live `active` rule or a blocked `draft`. A fresh seed
  // run has no prior "previously active" row to retire, so confirmed
  // rows go straight to `active` here rather than through the normal
  // draft→activate API dance a platform admin would use later.
  //
  // `authorityCode` defaults to `'PPB'` per `ReportingRuleSeed`'s own
  // doc comment — every candidate array predating Stage 13 only ever
  // targeted PPB, so this generalization is purely additive. Deleted and
  // recreated per-authority (not one blanket delete) so re-running the
  // seed against a subset of authorities never touches another
  // authority's own rules.
  const allReportingRules = [
    ...KENYA_ADR_REPORTING_RULE_CANDIDATES,
    ...KENYA_DEVICE_INCIDENT_REPORTING_RULES,
    ...KENYA_UNVERIFIED_REPORTING_RULE_CANDIDATES,
    ...KENYA_LINE_LISTING_REPORTING_RULE_CANDIDATE,
    ...UGANDA_ADR_REPORTING_RULE_CANDIDATES,
    ...CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES,
    ...KENYA_CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES,
    // Real-usage content, 11 Sep 2026 — Uganda/Tanzania/Rwanda/Ethiopia,
    // extracted from `vigicloud document formats/Country Specific
    // Requirements-AE and periodic reporting.xlsx` — see each candidate
    // array's own doc comment for sourcing detail and what was
    // deliberately left unseeded as too vague to codify.
    ...UGANDA_CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES,
    ...TANZANIA_ADR_REPORTING_RULE_CANDIDATES,
    ...TANZANIA_DEVICE_INCIDENT_REPORTING_RULE_CANDIDATES,
    ...TANZANIA_CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES,
    ...RWANDA_ADR_REPORTING_RULE_CANDIDATES,
    ...RWANDA_CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES,
    ...ETHIOPIA_ADR_REPORTING_RULE_CANDIDATES,
    ...ETHIOPIA_CLINICAL_TRIAL_SAE_REPORTING_RULE_CANDIDATES,
  ]
  // Upserted in place per (authorityId, reportTypeId, seriousnessClass) —
  // **not** the blanket delete-then-recreate this block used before
  // VigiCloud Stage 13. `ReportingRule` has no DB-level unique constraint
  // on that triplet (Prisma's own `.upsert()` needs one), so this is a
  // manual find-then-branch, but the reasoning is the same as
  // `RegulatoryAuthority`'s own upsert above: found live, 9 Aug 2026,
  // re-running this seed against a real dev database that already had
  // months of genuine `Deadline` rows (every one of them a NOT NULL FK
  // to a `ReportingRule`) — the old blanket delete broke on
  // `deadline_reporting_rule_id_fkey` the moment it tried to delete a
  // PPB rule real cases were still pointing at. A fresh, empty database
  // never hit this (nothing referenced the rows yet), which is exactly
  // why it went unnoticed until now. Any existing row for these
  // authorities that's no longer in `allReportingRules` (a candidate
  // genuinely removed from the seed data) is only deleted if nothing
  // references it — real historical rows stay untouched, exactly as
  // this schema's own "never delete" convention requires everywhere
  // else.
  const reportingRuleAuthorityIds = [
    ...new Set(
      allReportingRules.map((c) =>
        authorityIdByCode.get(authorityKey(c.countryIso ?? 'KE', c.authorityCode ?? 'PPB'))!,
      ),
    ),
  ]
  const existingReportingRules = await prisma.reportingRule.findMany({
    where: { authorityId: { in: reportingRuleAuthorityIds } },
  })
  const naturalKey = (authorityId: string, reportTypeId: string, seriousnessClass: string) =>
    `${authorityId}::${reportTypeId}::${seriousnessClass}`
  const existingByNaturalKey = new Map(
    existingReportingRules.map((r) => [
      naturalKey(r.authorityId, r.reportTypeId, r.seriousnessClass),
      r,
    ]),
  )
  const seededNaturalKeys = new Set<string>()

  for (const c of allReportingRules) {
    const authorityId = authorityIdByCode.get(
      authorityKey(c.countryIso ?? 'KE', c.authorityCode ?? 'PPB'),
    )!
    const reportTypeId = reportTypeIdByKey.get(c.reportTypeKey)!
    const key = naturalKey(authorityId, reportTypeId, c.seriousnessClass)
    seededNaturalKeys.add(key)

    const data: {
      windowDays: number
      reportingPeriodDays: number | null
      unverified: boolean
      submissionDestination: string
      sourceReference: string
      status: 'draft' | 'active'
      effectiveFrom: Date
    } = {
      windowDays: c.windowDays,
      reportingPeriodDays: c.reportingPeriodDays ?? null,
      unverified: c.unverified,
      submissionDestination: c.submissionDestination ?? 'regulator',
      // Real-usage fix, 11 Sep 2026 — every candidate's own `note` had
      // been documenting its citation in this seed file's own source
      // comments only, never actually written to the DB column Admin
      // Configuration Console Gap 1 added `ReportingRule.sourceReference`
      // for. An admin reading the Country Rules screen had no way to see
      // why any rule (Kenya's included) carries the value it does.
      sourceReference: c.note,
      status: c.unverified ? 'draft' : 'active',
      effectiveFrom: new Date('2026-01-01'),
    }

    const existing = existingByNaturalKey.get(key)
    if (existing) {
      await prisma.reportingRule.update({ where: { id: existing.id }, data })
    } else {
      await prisma.reportingRule.create({
        data: {
          id: newId(),
          authorityId,
          reportTypeId,
          seriousnessClass: c.seriousnessClass,
          ...data,
        },
      })
    }
  }

  const staleRuleIds = existingReportingRules
    .filter(
      (r) => !seededNaturalKeys.has(naturalKey(r.authorityId, r.reportTypeId, r.seriousnessClass)),
    )
    .map((r) => r.id)
  if (staleRuleIds.length > 0) {
    await prisma.reportingRule.deleteMany({
      where: { id: { in: staleRuleIds }, deadlines: { none: {} } },
    })
  }

  // Form schemas — digitised directly from the six official PDFs (real
  // field structure, not placeholders), so these are safe to activate even
  // though the reporting-rule windows above are not.
  const kenyaId = countryIdByIso.get('KE')!
  await prisma.formSchema.deleteMany({ where: { countryId: kenyaId } })
  await prisma.formSchema.createMany({
    data: KENYA_FORM_SCHEMAS.map((f) => ({
      id: newId(),
      countryId: kenyaId,
      reportTypeId: reportTypeIdByKey.get(f.reportTypeKey)!,
      version: 1,
      jsonSchema: f.jsonSchema as Prisma.InputJsonValue,
      officialFormCode: f.officialFormCode,
      status: 'active' as const,
      effectiveFrom: new Date('2026-01-01'),
    })),
  })

  // Submission formats — channel confirmed per form (VigiFlow entry number
  // block on every PPB form; AEFI explicitly routes to DHIS2 instead).
  await prisma.submissionFormat.deleteMany({ where: { authorityId: { in: [ppbId, nvipId] } } })
  await prisma.submissionFormat.createMany({
    data: KENYA_SUBMISSION_FORMATS.map((s) => ({
      id: newId(),
      authorityId: s.authorityCode === 'PPB' ? ppbId : nvipId,
      reportTypeId: reportTypeIdByKey.get(s.reportTypeKey)!,
      version: 1,
      templateRef: s.templateRef,
      channel: s.channel,
      status: 'active' as const,
      effectiveFrom: new Date('2026-01-01'),
    })),
  })

  console.log(
    `Seeded ${authorityRows.length} regulatory authorities, ${REPORT_TYPES.length} report types, Kenya's 6 form schemas, ${KENYA_SERIOUSNESS_CRITERIA.length} seriousness criteria, ${allReportingRules.filter((c) => !c.unverified).length} confirmed + ${allReportingRules.filter((c) => c.unverified).length} unverified reporting rules, and ${KENYA_SUBMISSION_FORMATS.length} submission formats.`,
  )
}

/**
 * QualCloud (Phase 13) Stage 10.9 — the real country-by-country recall
 * rule content (`recall-rules.seed-data.ts`'s own doc comment carries
 * the full per-country sourcing). Upserted in place on each row's own
 * natural key (never delete-then-recreate — this project has hit that
 * exact bug class twice already for reporting rules and workflow
 * definitions), so a later re-seed against a database with real
 * accumulated `RecallRequirement` rows referencing today's live
 * version stays safe.
 */
async function seedRecallRules(): Promise<void> {
  let ruleSetCount = 0
  let ruleCount = 0

  for (const ruleSetSeed of RECALL_RULE_SETS) {
    const country = await prisma.country.findUnique({ where: { isoCode: ruleSetSeed.countryIso } })
    if (!country) throw new Error(`Unknown country ISO "${ruleSetSeed.countryIso}" in RECALL_RULE_SETS seed`)
    const authority = await prisma.regulatoryAuthority.findUnique({
      where: { countryId_code: { countryId: country.id, code: ruleSetSeed.authorityCode } },
    })
    if (!authority) {
      throw new Error(
        `Unknown authority "${ruleSetSeed.authorityCode}" for country "${ruleSetSeed.countryIso}" in RECALL_RULE_SETS seed`,
      )
    }

    let ruleSet = await prisma.recallRuleSet.findFirst({
      where: { countryId: country.id, regulatoryAuthorityId: authority.id },
      orderBy: { version: 'desc' },
    })
    if (!ruleSet) {
      ruleSet = await prisma.recallRuleSet.create({
        data: {
          id: newId(),
          countryId: country.id,
          regulatoryAuthorityId: authority.id,
          version: 1,
          status: 'live',
          signedOffAt: new Date('2026-09-30'),
          effectiveDate: new Date('2026-09-30'),
        },
      })
      ruleSetCount += 1
    }

    for (const ruleSeed of ruleSetSeed.rules) {
      await prisma.recallRule.upsert({
        where: { ruleSetId_code: { ruleSetId: ruleSet.id, code: ruleSeed.code } },
        update: {
          requirementText: ruleSeed.requirementText,
          appliesWhenClass: ruleSeed.appliesWhenClass ?? null,
          appliesWhenType: ruleSeed.appliesWhenType ?? null,
          anchorEvent: ruleSeed.anchorEvent,
          offset: ruleSeed.offset,
          dayBasis: ruleSeed.dayBasis,
          ownerRoleKey: ruleSeed.ownerRoleKey,
          sourceDoc: ruleSeed.sourceDoc,
          sourceInstrument: ruleSeed.sourceInstrument ?? null,
          sourceSection: ruleSeed.sourceSection ?? null,
          unverified: ruleSeed.unverified,
        },
        create: {
          id: newId(),
          ruleSetId: ruleSet.id,
          code: ruleSeed.code,
          requirementText: ruleSeed.requirementText,
          appliesWhenClass: ruleSeed.appliesWhenClass ?? null,
          appliesWhenType: ruleSeed.appliesWhenType ?? null,
          anchorEvent: ruleSeed.anchorEvent,
          offset: ruleSeed.offset,
          dayBasis: ruleSeed.dayBasis,
          ownerRoleKey: ruleSeed.ownerRoleKey,
          sourceDoc: ruleSeed.sourceDoc,
          sourceInstrument: ruleSeed.sourceInstrument ?? null,
          sourceSection: ruleSeed.sourceSection ?? null,
          unverified: ruleSeed.unverified,
        },
      })
      ruleCount += 1
    }
  }

  console.log(
    `Seeded ${ruleSetCount} new recall rule-set(s) (Tanzania/TMDA, Rwanda/RFDA, Zimbabwe/MCAZ) with ${ruleCount} rule(s) upserted in place.`,
  )
}

interface WorkflowStateSeed {
  key: string
  name: string
  isInitial: boolean
  isTerminal: boolean
}

interface WorkflowTransitionSeed {
  from: string
  to: string
  requiredRoleKey: string
  requiresSignature: boolean
}

/**
 * Generalized from Phase 5.1's original `pv_case`-only implementation
 * when VigiCloud Stage 17 added a second seeded workflow (`signal`) — the
 * logic itself (delete-then-recreate the default global definition,
 * rebuild states/transitions) was already fully record-type-agnostic,
 * it just wasn't parameterized yet. Behavior for `pv_case` is unchanged.
 *
 * RegCloud (Phase 12) Stage 4-7 fix — real bug found and fixed
 * 22 Aug 2026 during Stage 4-7's own live browser verification: the
 * original delete-then-recreate logic unconditionally deleted every
 * `WorkflowInstance` for the record type being re-seeded, including any
 * real, in-progress instance a live tenant record (a PV case, a signal,
 * a reg dossier) already points at — the exact same "delete-then-
 * recreate breaks the moment real data references what it deletes"
 * class of bug CLAUDE.md's gotchas list already documents for the
 * `ReportingRule` seed block, just for workflow instances instead of
 * reporting rules. A real dossier sitting at `completeness_check`
 * silently lost its own `WorkflowInstance` (and therefore every future
 * transition) the moment this seed script was re-run to pick up Stage
 * 4-7's own extended state graph — `RegDossierService.get()`'s graceful
 * fallback to the denormalized `status` column meant this failed
 * silently (no error, no crash), not loudly, making it easy to miss.
 * Fixed by re-pointing every existing instance at the matching new
 * state (by `stateKey`) instead of deleting it, whenever that state
 * still exists in the new graph — only an instance whose own current
 * state was itself removed from the new graph (a genuine incompatible
 * change, not a pure extension) falls back to deletion, logged loudly
 * so it's never silent.
 */
async function seedWorkflowDefinition(
  recordType: string,
  states: readonly WorkflowStateSeed[],
  transitions: readonly WorkflowTransitionSeed[],
): Promise<void> {
  const requiredRoleKeys = [...new Set(transitions.map((t) => t.requiredRoleKey))]
  const roles = await prisma.role.findMany({ where: { key: { in: requiredRoleKeys } } })
  const roleIdByKey = new Map(roles.map((r) => [r.key, r.id]))
  for (const key of requiredRoleKeys) {
    if (!roleIdByKey.has(key)) {
      throw new Error(
        `Role "${key}" must be seeded before the workflow engine (seedRolesAndPermissions runs first)`,
      )
    }
  }

  // Re-derived from scratch each run, same pattern as the other seed
  // sections — but any real, live WorkflowInstance is preserved (see the
  // doc comment above), never blindly deleted alongside its old
  // definition/states/transitions.
  const existing = await prisma.workflowDefinition.findFirst({
    where: { recordType, countryId: null, reportTypeId: null },
  })
  const liveInstances = existing
    ? await prisma.workflowInstance.findMany({
        where: { definitionId: existing.id },
        include: { currentState: { select: { stateKey: true } } },
      })
    : []

  const definitionId = newId()
  await prisma.workflowDefinition.create({
    data: {
      id: definitionId,
      recordType,
      reportTypeId: null,
      countryId: null,
      version: 1,
      status: 'active',
    },
  })

  const stateIdByKey = new Map<string, string>()
  for (const state of states) {
    const id = newId()
    await prisma.workflowState.create({
      data: {
        id,
        definitionId,
        stateKey: state.key,
        name: state.name,
        isInitial: state.isInitial,
        isTerminal: state.isTerminal,
      },
    })
    stateIdByKey.set(state.key, id)
  }

  for (const transition of transitions) {
    await prisma.workflowTransition.create({
      data: {
        id: newId(),
        definitionId,
        fromStateId: stateIdByKey.get(transition.from)!,
        toStateId: stateIdByKey.get(transition.to)!,
        requiredRoleId: roleIdByKey.get(transition.requiredRoleKey)!,
        requiresSignature: transition.requiresSignature,
      },
    })
  }

  let preserved = 0
  let orphaned = 0
  for (const instance of liveInstances) {
    const newStateId = stateIdByKey.get(instance.currentState.stateKey)
    if (newStateId) {
      await prisma.workflowInstance.update({
        where: { id: instance.id },
        data: { definitionId, currentStateId: newStateId },
      })
      preserved += 1
    } else {
      // The state this instance was sitting in no longer exists in the
      // new graph — there is no safe mapping, so (and only so) this one
      // real record is orphaned from workflow tracking. Logged loudly,
      // never silently, unlike the bug this whole block fixes.
      console.warn(
        `  WARNING: workflow instance ${instance.id} (record ${instance.recordType}/${instance.recordId}) was sitting in state "${instance.currentState.stateKey}", which no longer exists in the new "${recordType}" workflow graph — deleting this instance. The record's own denormalized status column is unaffected, but it can no longer transition until this is resolved by hand.`,
      )
      await prisma.workflowInstance.delete({ where: { id: instance.id } })
      orphaned += 1
    }
  }

  if (existing) {
    await prisma.workflowTransition.deleteMany({ where: { definitionId: existing.id } })
    await prisma.workflowState.deleteMany({ where: { definitionId: existing.id } })
    await prisma.workflowDefinition.delete({ where: { id: existing.id } })
  }

  console.log(
    `Seeded the default "${recordType}" workflow v1: ${states.length} states, ${transitions.length} transitions` +
      (liveInstances.length > 0
        ? ` (${preserved} live instance(s) preserved, ${orphaned} orphaned).`
        : '.'),
  )
}

async function seedWorkflowEngine(): Promise<void> {
  await seedWorkflowDefinition(
    PV_CASE_WORKFLOW_RECORD_TYPE,
    PV_CASE_WORKFLOW_STATES,
    PV_CASE_WORKFLOW_TRANSITIONS,
  )
  await seedWorkflowDefinition(
    SIGNAL_WORKFLOW_RECORD_TYPE,
    SIGNAL_WORKFLOW_STATES,
    SIGNAL_WORKFLOW_TRANSITIONS,
  )
  await seedWorkflowDefinition(
    REG_REGISTRATION_WORKFLOW_RECORD_TYPE,
    REG_REGISTRATION_WORKFLOW_STATES,
    REG_REGISTRATION_WORKFLOW_TRANSITIONS,
  )
  await seedWorkflowDefinition(
    PROMOTIONAL_MATERIAL_WORKFLOW_RECORD_TYPE,
    PROMOTIONAL_MATERIAL_WORKFLOW_STATES,
    PROMOTIONAL_MATERIAL_WORKFLOW_TRANSITIONS,
  )
  await seedWorkflowDefinition(
    RECALL_WORKFLOW_RECORD_TYPE,
    RECALL_WORKFLOW_STATES,
    RECALL_WORKFLOW_TRANSITIONS,
  )
  await seedWorkflowDefinition(
    PERIODIC_REPORT_WORKFLOW_RECORD_TYPE,
    PERIODIC_REPORT_WORKFLOW_STATES,
    PERIODIC_REPORT_WORKFLOW_TRANSITIONS,
  )
  await seedWorkflowDefinition(
    QUALITY_CONTROLLED_DOCUMENT_WORKFLOW_RECORD_TYPE,
    QUALITY_CONTROLLED_DOCUMENT_WORKFLOW_STATES,
    QUALITY_CONTROLLED_DOCUMENT_WORKFLOW_TRANSITIONS,
  )
  await seedWorkflowDefinition(
    QUALITY_DEVIATION_WORKFLOW_RECORD_TYPE,
    QUALITY_DEVIATION_WORKFLOW_STATES,
    QUALITY_DEVIATION_WORKFLOW_TRANSITIONS,
  )
  await seedWorkflowDefinition(
    QUALITY_CHANGE_CONTROL_WORKFLOW_RECORD_TYPE,
    QUALITY_CHANGE_CONTROL_WORKFLOW_STATES,
    QUALITY_CHANGE_CONTROL_WORKFLOW_TRANSITIONS,
  )
  await seedWorkflowDefinition(
    QUALITY_COMPLAINT_WORKFLOW_RECORD_TYPE,
    QUALITY_COMPLAINT_WORKFLOW_STATES,
    QUALITY_COMPLAINT_WORKFLOW_TRANSITIONS,
  )
  await seedWorkflowDefinition(
    QUALITY_OOS_WORKFLOW_RECORD_TYPE,
    QUALITY_OOS_WORKFLOW_STATES,
    QUALITY_OOS_WORKFLOW_TRANSITIONS,
  )
}

async function seedMeddra(): Promise<void> {
  const existingVersion = await prisma.meddraVersion.findUnique({
    where: { versionLabel: MEDDRA_VERSION_LABEL },
  })
  if (existingVersion) {
    await prisma.meddraTerm.deleteMany({ where: { versionId: existingVersion.id } })
    await prisma.meddraVersion.delete({ where: { id: existingVersion.id } })
  }

  const versionId = newId()
  await prisma.meddraVersion.create({
    data: {
      id: versionId,
      versionLabel: MEDDRA_VERSION_LABEL,
      releasedOn: new Date(MEDDRA_VERSION_RELEASED_ON),
    },
  })

  let codeCounter = 1
  const nextCode = () => `MOCK-${String(codeCounter++).padStart(6, '0')}`
  let termCount = 0

  for (const soc of MEDDRA_SOCS) {
    const socId = newId()
    await prisma.meddraTerm.create({
      data: { id: socId, versionId, code: nextCode(), level: 'SOC', name: soc.name },
    })
    termCount++

    for (const hlgt of soc.hlgts) {
      const hlgtId = newId()
      await prisma.meddraTerm.create({
        data: {
          id: hlgtId,
          versionId,
          code: nextCode(),
          level: 'HLGT',
          name: hlgt.name,
          parentId: socId,
        },
      })
      termCount++

      for (const hlt of hlgt.hlts) {
        const hltId = newId()
        await prisma.meddraTerm.create({
          data: {
            id: hltId,
            versionId,
            code: nextCode(),
            level: 'HLT',
            name: hlt.name,
            parentId: hlgtId,
          },
        })
        termCount++

        for (const pt of hlt.pts) {
          const ptId = newId()
          await prisma.meddraTerm.create({
            data: {
              id: ptId,
              versionId,
              code: nextCode(),
              level: 'PT',
              name: pt.name,
              parentId: hltId,
            },
          })
          termCount++

          for (const llt of pt.llts) {
            await prisma.meddraTerm.create({
              data: {
                id: newId(),
                versionId,
                code: nextCode(),
                level: 'LLT',
                name: llt.name,
                parentId: ptId,
              },
            })
            termCount++
          }
        }
      }
    }
  }

  console.log(
    `Seeded MedDRA ${MEDDRA_VERSION_LABEL}: ${termCount} mock terms across the SOC→LLT hierarchy.`,
  )
}

async function seedWhoDrug(): Promise<void> {
  const existingVersion = await prisma.whoDrugVersion.findUnique({
    where: { versionLabel: WHO_DRUG_VERSION_LABEL },
  })
  if (existingVersion) {
    await prisma.whoDrugTerm.deleteMany({ where: { versionId: existingVersion.id } })
    await prisma.whoDrugVersion.delete({ where: { id: existingVersion.id } })
  }

  const versionId = newId()
  await prisma.whoDrugVersion.create({
    data: {
      id: versionId,
      versionLabel: WHO_DRUG_VERSION_LABEL,
      releasedOn: new Date(WHO_DRUG_VERSION_RELEASED_ON),
    },
  })

  let drnCounter = 1
  const nextDrn = () => `MOCK-DRN-${String(drnCounter++).padStart(6, '0')}`

  for (const term of WHO_DRUG_TERMS) {
    await prisma.whoDrugTerm.create({
      data: {
        id: newId(),
        versionId,
        drugRecordNumber: nextDrn(),
        name: term.name,
        substanceName: term.substanceName,
        atcCode: term.atcCode,
      },
    })
  }

  console.log(`Seeded WHODrug ${WHO_DRUG_VERSION_LABEL}: ${WHO_DRUG_TERMS.length} mock drug terms.`)
}

async function seedAuditRequirements(): Promise<void> {
  const ppb = await prisma.regulatoryAuthority.findFirst({ where: { code: 'PPB' } })
  if (!ppb) {
    throw new Error(
      'Kenya PPB authority must be seeded before audit requirements (run seedCountryRulesEngine first)',
    )
  }

  // Upsert on the natural key `(authorityId, requirementKey)` — per this
  // repo's own established gotcha (Stage 13/14's reporting-rule seed
  // fix): a blanket delete-then-recreate breaks the moment real
  // `AuditRequirementRecord` rows reference a definition row.
  for (const req of AUDIT_REQUIREMENTS) {
    // `guidelineReference` is only ever included when this seed row
    // actually carries one (11 Sep 2026 real-usage content, sourced from
    // the real PPB PV Inspection Checklist) — omitted entirely from
    // `update`, not set to `null`, for a row seeded before this field's
    // own citations existed, so a platform admin's own manually-entered
    // citation via `/admin/audit-checklist` (Gap 3's own established
    // workflow) is never silently overwritten by a reseed.
    const guidelineReference =
      req.guidelineReference !== undefined ? { guidelineReference: req.guidelineReference } : {}
    await prisma.auditRequirementDefinition.upsert({
      where: {
        authorityId_requirementKey: { authorityId: ppb.id, requirementKey: req.requirementKey },
      },
      create: {
        id: newId(),
        authorityId: ppb.id,
        requirementKey: req.requirementKey,
        sortOrder: req.sortOrder,
        title: req.title,
        description: req.description,
        source: req.source,
        evidenceArtifactType: req.evidenceArtifactType,
        isMandatory: req.isMandatory,
        ...guidelineReference,
      },
      update: {
        sortOrder: req.sortOrder,
        title: req.title,
        description: req.description,
        source: req.source,
        evidenceArtifactType: req.evidenceArtifactType,
        isMandatory: req.isMandatory,
        ...guidelineReference,
      },
    })
  }

  console.log(`Seeded ${AUDIT_REQUIREMENTS.length} audit-readiness requirement rows for PPB.`)
}

/**
 * QualCloud (Phase 13) Stage 9 — same upsert-on-natural-key discipline
 * as `seedAuditRequirements()` above, on `(authorityId, sectionKey)`.
 */
async function seedInspectionChecklist(): Promise<void> {
  const ppb = await prisma.regulatoryAuthority.findFirst({ where: { code: 'PPB' } })
  if (!ppb) {
    throw new Error(
      'Kenya PPB authority must be seeded before the inspection checklist (run seedCountryRulesEngine first)',
    )
  }

  for (const section of INSPECTION_CHECKLIST_SECTIONS) {
    await prisma.inspectionChecklistTemplate.upsert({
      where: { authorityId_sectionKey: { authorityId: ppb.id, sectionKey: section.sectionKey } },
      create: {
        id: newId(),
        authorityId: ppb.id,
        sectionKey: section.sectionKey,
        title: section.title,
        description: section.description,
        mappedRecordType: section.mappedRecordType,
        sortOrder: section.sortOrder,
        guidelineReference: section.guidelineReference ?? null,
      },
      update: {
        title: section.title,
        description: section.description,
        mappedRecordType: section.mappedRecordType,
        sortOrder: section.sortOrder,
        ...(section.guidelineReference !== undefined
          ? { guidelineReference: section.guidelineReference }
          : {}),
      },
    })
  }

  console.log(
    `Seeded ${INSPECTION_CHECKLIST_SECTIONS.length} inspection-checklist section rows for PPB.`,
  )
}

/**
 * Special Corner SC-8 (Admin Configuration Console — training-type
 * catalog) — real seed content for the two markets/scopes this app
 * actually knows about today: Kenya's own GVP Certificate/PPB Academy
 * programs, plus two generic entries available everywhere. No unique
 * DB constraint exists on `(countryId, typeKey)` (Postgres treats
 * multiple NULL `countryId`s as distinct, so a partial/compound unique
 * index can't express "one generic entry per typeKey" cleanly) — this
 * loop does the equivalent find-then-create-or-update manually instead
 * of a Prisma `upsert`, matching the natural-key-upsert discipline
 * `seedAuditRequirements()` already established, just without the DB
 * doing the matching for us.
 */
async function seedTrainingTypes(): Promise<void> {
  const kenya = await prisma.country.findFirst({ where: { isoCode: 'KE' } })
  if (!kenya) {
    throw new Error('Kenya must be seeded before training types (run seedCountries first)')
  }

  const entries: { countryId: string | null; typeKey: string; label: string; sortOrder: number }[] =
    [
      { countryId: kenya.id, typeKey: 'gvp_certificate', label: 'GVP Certificate', sortOrder: 1 },
      { countryId: kenya.id, typeKey: 'ppb_academy', label: 'PPB Academy', sortOrder: 2 },
      { countryId: null, typeKey: 'internal', label: 'Internal', sortOrder: 100 },
      { countryId: null, typeKey: 'other', label: 'Other', sortOrder: 101 },
    ]

  for (const entry of entries) {
    const existing = await prisma.trainingTypeCatalogEntry.findFirst({
      where: { countryId: entry.countryId, typeKey: entry.typeKey },
    })
    if (existing) {
      await prisma.trainingTypeCatalogEntry.update({
        where: { id: existing.id },
        data: { label: entry.label, sortOrder: entry.sortOrder },
      })
    } else {
      await prisma.trainingTypeCatalogEntry.create({
        data: {
          id: newId(),
          countryId: entry.countryId,
          typeKey: entry.typeKey,
          label: entry.label,
          sortOrder: entry.sortOrder,
        },
      })
    }
  }

  console.log(`Seeded ${entries.length} training-type catalog entries.`)
}

/**
 * QualCloud (Phase 13) Stage 15 — the waste-disposal-method catalog.
 * Genuinely, honestly generic — no real PPB waste-disposal procedure
 * document exists anywhere in this project's reference material, so
 * these five entries are deliberately the plain, jurisdiction-agnostic
 * default values named on `WasteDisposalRecord.disposalMethod`'s own
 * schema doc comment, never a fabricated citation. A real PPB-sourced
 * list can replace/extend these later via
 * `PATCH /platform/waste-disposal-methods` with zero code change.
 * Upserted on the real `@@unique([methodKey])` natural key.
 */
async function seedWasteDisposalMethods(): Promise<void> {
  const entries = [
    { methodKey: 'incineration', label: 'Incineration', sortOrder: 1 },
    { methodKey: 'encapsulation', label: 'Encapsulation', sortOrder: 2 },
    { methodKey: 'return_to_supplier', label: 'Return to Supplier', sortOrder: 3 },
    { methodKey: 'landfill_authorized', label: 'Authorized Landfill', sortOrder: 4 },
    { methodKey: 'other', label: 'Other', sortOrder: 100 },
  ]
  for (const entry of entries) {
    await prisma.wasteDisposalMethodCatalogEntry.upsert({
      where: { methodKey: entry.methodKey },
      create: { id: newId(), ...entry },
      update: { label: entry.label, sortOrder: entry.sortOrder },
    })
  }
  console.log(`Seeded ${entries.length} waste-disposal-method catalog entries.`)
}

/**
 * RegCloud (Phase 12) Stage 0.4 — the one real, confirmed row this pass
 * seeds: Kenya's own registration renewal cadence (5 years — the discovery
 * transcript's own confirmed answer, `regcloud docs/SafeMeds Discovery
 * Robert QMS & Reg (1).docx`), applying to every product class (the `"*"`
 * sentinel — Robert's answer didn't distinguish by class). Seeded directly
 * `active`/`unverified: false`, same as `seedCountryRulesEngine()`'s own
 * `ReportingRule` rows — bypassing the normal draft-then-`.../activate`
 * application flow is fine for seed data, matching that precedent exactly.
 * Find-then-create-or-update on the natural key (never delete-then-recreate
 * — see the reporting-rule seed's own gotcha, CLAUDE.md), so a re-run never
 * risks the `..._one_active_per_key` partial unique index or orphans a
 * still-referenced row.
 */
async function seedRegCloudFoundation(): Promise<void> {
  const kenya = await prisma.country.findFirst({ where: { isoCode: 'KE' } })
  const ppb = kenya
    ? await prisma.regulatoryAuthority.findFirst({ where: { countryId: kenya.id, code: 'PPB' } })
    : null
  if (!kenya || !ppb) {
    throw new Error(
      'Kenya/PPB must be seeded before RegCloud foundation data (run seedCountryRulesEngine first)',
    )
  }

  const key = {
    countryId: kenya.id,
    authorityId: ppb.id,
    productClass: '*',
    obligationType: 'renewal',
  }
  const data = {
    intervalValue: 5,
    intervalUnit: 'years' as const,
    clockStart: 'issued_on',
    unverified: false,
    sourceReference:
      'SafeMeds Discovery — Robert QMS & Reg interview: confirmed 5-year Kenya PPB registration renewal cycle',
    status: 'active' as const,
    effectiveFrom: new Date('2026-01-01'),
  }

  const existing = await prisma.regDeadlineRule.findFirst({ where: key })
  if (existing) {
    await prisma.regDeadlineRule.update({ where: { id: existing.id }, data })
  } else {
    await prisma.regDeadlineRule.create({ data: { id: newId(), version: 1, ...key, ...data } })
  }

  // Stage 4 — the report-type-equivalent `SubmissionFormat` reuse
  // `todo-regcloud.md`'s own Stage 4 bullet calls for. `ReportType.moduleKey`
  // already anticipated a future `regcloud` value from the day that
  // column was added (VigiCloud Stage 0.10) — this is that future
  // arriving, not a new mechanism. No real `SubmissionFormat` row is
  // seeded against it yet (Kenya's own registration-submission channel
  // isn't sourced in `regcloud docs/`) — `RegSubmissionService.generate()`
  // gracefully defaults to `paper_pdf` until an admin configures a real
  // one via the existing Admin Configuration Console.
  await prisma.reportType.upsert({
    where: { typeKey: 'reg_dossier' },
    update: { name: 'Regulatory Dossier Submission', moduleKey: 'regcloud' },
    create: {
      id: newId(),
      typeKey: 'reg_dossier',
      name: 'Regulatory Dossier Submission',
      moduleKey: 'regcloud',
    },
  })

  // Stage 5 — PRIMS's own real query/response turnaround isn't sourced
  // (`todo-regcloud.md`'s own field-expert-confirmation flag on this
  // exact point) — seeded as a genuinely `unverified: true` candidate,
  // status `draft`, matching the exact seeding discipline
  // `KENYA_UNVERIFIED_REPORTING_RULE_CANDIDATES` already established:
  // structurally present so the mechanism is real and testable, but
  // `resolveDeadlineRule()` will never resolve it (only `active` rows
  // qualify) until a platform admin confirms and activates a real one.
  const queryResponseKey = {
    countryId: kenya.id,
    authorityId: ppb.id,
    productClass: '*',
    obligationType: 'query_response',
  }
  const queryResponseData = {
    intervalValue: 30,
    intervalUnit: 'days' as const,
    // Purely descriptive — `RegDeadlineService.computeOrRecompute()` never
    // branches on this field's value, the caller always supplies the real
    // `triggerDate` explicitly (here, `RegQuery.receivedDate`, not a
    // registration's `issuedOn`). Set correctly anyway for anyone reading
    // this row directly.
    clockStart: 'received_date',
    unverified: true,
    sourceReference:
      'Placeholder pending PRIMS field-expert confirmation — not a sourced regulatory requirement, structurally blocked from activation.',
    status: 'draft' as const,
    effectiveFrom: new Date('2026-01-01'),
  }
  const existingQueryResponse = await prisma.regDeadlineRule.findFirst({ where: queryResponseKey })
  if (existingQueryResponse) {
    await prisma.regDeadlineRule.update({
      where: { id: existingQueryResponse.id },
      data: queryResponseData,
    })
  } else {
    await prisma.regDeadlineRule.create({
      data: { id: newId(), version: 1, ...queryResponseKey, ...queryResponseData },
    })
  }

  // Admin Configurability checklist item 4 — PPB's real, named 7 product
  // classes, sourced directly from `SafeMeds_Regulatory_Workflow_Map.pdf`'s
  // own "Product classes in scope" section ("PPB registers seven product
  // classes... medicines; vaccines and biologicals; blood and blood
  // products; medical devices and IVDs; cosmetics; food supplements;
  // herbal and complementary medicines") — that document's own header
  // states it was "verified against the Pharmacy and Poisons Board's
  // published mandate (August 2026)", a real primary citation, not a
  // guess. Seeded as a curated *suggestion* list only (see
  // `ProductClassDefinition`'s own schema doc comment) — every existing
  // free-text `productClass` value elsewhere in the schema is completely
  // unaffected; this just gives every future picker something real to
  // suggest instead of a placeholder string.
  const productClasses: { classKey: string; label: string }[] = [
    { classKey: 'medicines', label: 'Medicines' },
    { classKey: 'vaccines_and_biologicals', label: 'Vaccines & Biologicals' },
    { classKey: 'blood_and_blood_products', label: 'Blood & Blood Products' },
    { classKey: 'medical_devices_and_ivds', label: 'Medical Devices & IVDs' },
    { classKey: 'cosmetics', label: 'Cosmetics' },
    { classKey: 'food_supplements', label: 'Food Supplements' },
    { classKey: 'herbal_and_complementary_medicines', label: 'Herbal & Complementary Medicines' },
  ]
  for (const [index, pc] of productClasses.entries()) {
    const pcKey = { authorityId: ppb.id, classKey: pc.classKey }
    const pcData = {
      label: pc.label,
      sourceReference:
        "SafeMeds_Regulatory_Workflow_Map.pdf, 'Product classes in scope' — verified against PPB's published mandate, Aug 2026",
      sortOrder: index,
      active: true,
    }
    const existingClass = await prisma.productClassDefinition.findFirst({ where: pcKey })
    if (existingClass) {
      await prisma.productClassDefinition.update({ where: { id: existingClass.id }, data: pcData })
    } else {
      await prisma.productClassDefinition.create({ data: { id: newId(), ...pcKey, ...pcData } })
    }
  }

  // Real-usage request, 1 Oct 2026 — a clinical trial application dossier
  // (`RegDossier.productClass = 'clinical_trial'`) had no
  // `RegulatoryRequirement`/`RequiredDocumentDefinition` rows at all, so
  // its completeness checklist (`CompletenessGateService`) showed nothing
  // to upload. "Clinical trial" isn't one of PPB's own 7 named product
  // classes (`ProductClassDefinition` above, sourced from the Workflow
  // Map's "Product classes in scope" section) — it's a distinct
  // *application type*, not a product category, exactly the same
  // distinction RegCloud Stage 12 already drew by giving clinical trials
  // their own `ClinicalTrial` model rather than folding them into
  // `ProductRegistration`. `productClass` stays plain free-text (per its
  // own schema doc comment, "a market with an unconfigured taxonomy is
  // never blocked from typing a class name"), so `'clinical_trial'` is a
  // legitimate value here without needing a schema change, matching the
  // exact mechanism every other product class's own checklist already
  // uses. Upserts in place on the natural key (never delete-then-
  // recreate, matching this seed script's own established discipline —
  // see CLAUDE.md's reporting-rule-seed gotcha) so a real dossier's
  // already-created `RegDossierDocumentSlot` rows (which hold their own
  // FK to a specific `RequiredDocumentDefinition` row) are never
  // orphaned by a future reseed.
  const requirementKey = {
    countryId: kenya.id,
    authorityId: ppb.id,
    productClass: 'clinical_trial',
    route: '*',
  }
  let clinicalTrialRequirement = await prisma.regulatoryRequirement.findFirst({
    where: { ...requirementKey, status: 'active' },
  })
  if (!clinicalTrialRequirement) {
    clinicalTrialRequirement = await prisma.regulatoryRequirement.create({
      data: {
        id: newId(),
        ...requirementKey,
        description: 'Clinical Trial Application — PPB (Kenya)',
        unverified: true,
        sourceReference:
          'PPB clinical trial application checklist (vigicloud docs/RegCloud discovery material) — document list, not yet checked against a primary-source PPB guideline citation-by-citation.',
        version: 1,
        status: 'active',
        effectiveFrom: new Date('2026-01-01'),
      },
    })
  }

  const clinicalTrialDocuments: {
    documentKey: string
    name: string
    ctdModule: string | null
  }[] = [
    { documentKey: 'ct_cover_letter', name: 'Cover Letter (addressed to the PPB Registrar)', ctdModule: 'Module 1' },
    { documentKey: 'ct_application_form', name: 'Completed Clinical Trial Application Form', ctdModule: 'Module 1' },
    { documentKey: 'ct_study_protocol', name: "Study Protocol (with versions/dates/amendments)", ctdModule: 'Module 1' },
    { documentKey: 'ct_investigators_brochure', name: "Investigator's Brochure (IB)", ctdModule: 'Module 1' },
    {
      documentKey: 'ct_cmc_impd',
      name: 'Product Quality/Manufacturing (CMC) Documentation / IMPD',
      ctdModule: 'Module 3',
    },
    {
      documentKey: 'ct_informed_consent',
      name: 'Informed Consent Materials (English + local languages)',
      ctdModule: 'Module 1',
    },
    {
      documentKey: 'ct_ethical_approval',
      name: 'Ethical Approval (NACOSTI-accredited SERC clearance certificate)',
      ctdModule: 'Module 1',
    },
    {
      documentKey: 'ct_investigator_credentials',
      name: 'Investigator Credentials (abridged CVs max 4 pages + GCP certificates)',
      ctdModule: 'Module 1',
    },
    {
      documentKey: 'ct_admin_legal_documents',
      name: 'Administrative and Legal Documents (trial insurance, institutional affiliation letters, grant/funding letters, MTAs if applicable)',
      ctdModule: 'Module 1',
    },
    { documentKey: 'ct_fee_payment_evidence', name: 'Evidence of Fee Payment', ctdModule: 'Module 1' },
  ]

  for (const [index, doc] of clinicalTrialDocuments.entries()) {
    const docKey = { regulatoryRequirementId: clinicalTrialRequirement.id, documentKey: doc.documentKey }
    const docData = {
      name: doc.name,
      ctdModule: doc.ctdModule,
      isMandatory: true,
      sourceReference:
        'Real-usage request, 1 Oct 2026 — PPB clinical trial application document checklist.',
      sortOrder: index,
    }
    const existingDoc = await prisma.requiredDocumentDefinition.findFirst({ where: docKey })
    if (existingDoc) {
      await prisma.requiredDocumentDefinition.update({ where: { id: existingDoc.id }, data: docData })
    } else {
      await prisma.requiredDocumentDefinition.create({ data: { id: newId(), ...docKey, ...docData } })
    }
  }

  console.log(
    "Seeded RegCloud foundation data: Kenya PPB 5-year registration renewal rule, the reg_dossier report type, an unverified query-response deadline candidate, PPB's real 7 product classes, and the clinical trial application's 10-document completeness checklist.",
  )
}

async function main(): Promise<void> {
  // Phase 1: countries (Phase 4 will layer the deep rules engine on top of
  // this same table) and one demo platform reviewer — there is no
  // platform-staff self-signup, so review/approval flows need a seeded
  // account to test against. Phase 2: the role/permission catalog. Grows
  // further per phase: Kenya config (P4), workflow definitions (P5), demo
  // tenant (dev).
  await seedCountries()
  await seedDemoPlatformAdmin()
  await seedRolesAndPermissions()
  await seedCountryRulesEngine()
  await seedRecallRules()
  await seedWorkflowEngine()
  await seedMeddra()
  await seedWhoDrug()
  await seedAuditRequirements()
  await seedInspectionChecklist()
  await seedTrainingTypes()
  await seedWasteDisposalMethods()
  await seedRegCloudFoundation()
}

void main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
