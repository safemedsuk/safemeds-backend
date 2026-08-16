import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditRequirementStatus, Prisma } from '@prisma/client'

import { isAfterHoursOrWeekend } from '../../common/after-hours.util'
import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { LITERATURE_MONITORING_CURRENCY_WINDOW_DAYS } from '../pv/literature-monitoring.service'
import { UpdateAuditRequirementDto } from './dto/update-audit-requirement.dto'

export interface RequestMeta {
  ip?: string
}

export const AUDIT_REQUIREMENT_RECORD_TYPE = 'audit_requirement_record'

export interface AuditRequirementRow {
  definitionId: string
  requirementKey: string
  sortOrder: number
  title: string
  description: string
  source: 'system_generated' | 'person_uploads'
  evidenceArtifactType: string
  isMandatory: boolean
  status: AuditRequirementStatus
  statusNote: string | null
  evidenceDocumentId: string | null
  lastVerifiedAt: Date | null
  nextDueAt: Date | null
  checklistJson: unknown
}

export interface AuditReadinessDashboard {
  overall: 'green' | 'amber' | 'red'
  readyCount: number
  totalMandatory: number
  rows: AuditRequirementRow[]
  /**
   * testing-todo Stage 16.2-A — an empty `rows` array is genuinely
   * ambiguous to a caller with no other context: is this company's home
   * country just not configured yet (a real, honest empty state), or is
   * something actually broken? These two fields let the frontend say
   * which, instead of rendering a silent blank table.
   */
  homeCountryName: string
  authorityConfigured: boolean
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'The audit-readiness dashboard is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

type Tx = Prisma.TransactionClient

/**
 * VigiCloud Stage 16.2 — one resolver per `system_generated` requirement
 * key, each reading the real underlying table live rather than trusting
 * a stored status that could drift. Modeled on `ValidityGateService`'s
 * own "cannot show fully ready until every mandatory item is present"
 * reasoning (Stage 4), just across many more data sources. A resolver
 * returning `{ status: 'missing', note: '...' }` when the real
 * underlying data just isn't there yet (e.g. `literature_monitoring`
 * before any run has ever been logged) is the same honest-degradation
 * pattern `TriageService`'s `deadlineUnavailable` flag already
 * established — never a fabricated "ready". `literature_monitoring`
 * itself used to be hardcoded `missing` outright ("Stage 19 doesn't
 * exist yet") — now that Stage 19 is built, it reads the real table
 * like every other resolver here.
 */
type SystemResolver = (
  tx: Tx,
  companyId: string,
) => Promise<{ status: AuditRequirementStatus; note?: string }>

const SYSTEM_RESOLVERS: Record<string, SystemResolver> = {
  qppv_nomination: async (tx, companyId) => {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { primaryQppvUserId: true },
    })
    if (!company?.primaryQppvUserId) {
      return { status: 'missing', note: 'No primary QPPV nominated yet.' }
    }
    const nomination = await tx.qppvNomination.findFirst({
      where: {
        companyId,
        qppvUserId: company.primaryQppvUserId,
        role: 'primary',
        status: 'active',
      },
    })
    if (!nomination) {
      return {
        status: 'missing',
        note: 'Primary QPPV is set but has no recorded nomination event.',
      }
    }
    if (!nomination.regulatorConfirmationDocumentId) {
      return {
        status: 'needs_update',
        note: 'Nomination letter generated, but the regulator confirmation has not been uploaded yet.',
      }
    }
    return { status: 'ready' }
  },

  qppv_staff_training: async (tx, companyId) => {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { primaryQppvUserId: true },
    })
    if (!company?.primaryQppvUserId) {
      return { status: 'missing', note: 'No primary QPPV to check training records for.' }
    }
    const now = new Date()
    const valid = await tx.trainingRecord.findFirst({
      where: {
        companyId,
        userId: company.primaryQppvUserId,
        OR: [{ expiryDate: null }, { expiryDate: { gte: now } }],
      },
    })
    return valid
      ? { status: 'ready' }
      : { status: 'missing', note: 'No current (non-expired) training record for the QPPV.' }
  },

  psmf_in_place: async (tx, companyId) => {
    const active = await tx.psmf.findFirst({ where: { companyId, status: 'active' } })
    return active ? { status: 'ready' } : { status: 'missing', note: 'No active PSMF version.' }
  },

  archiving_retention: () =>
    Promise.resolve({
      status: 'ready' as const,
      note: 'Structural platform guarantee — never-delete/deactivate-only convention plus an append-only audit trail, always on, not a per-company setting.',
    }),

  availability_evidence: async (tx, companyId) => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 180)
    const [attempts, calls] = await Promise.all([
      tx.contactTestAttempt.findMany({
        where: { companyId, outcome: 'reached', occurredAt: { gte: cutoff } },
        select: { occurredAt: true },
      }),
      // Stage 21 — a real logged after-hours call/voicemail is itself
      // evidence the line is reachable and being monitored 24/7, on top
      // of (not instead of) a deliberate periodic reachability test.
      tx.callLog.findMany({
        where: { companyId, occurredAt: { gte: cutoff } },
        select: { occurredAt: true },
      }),
    ])
    const anyAfterHours = [...attempts, ...calls].some((a) => isAfterHoursOrWeekend(a.occurredAt))
    if (anyAfterHours) return { status: 'ready' }
    if (attempts.length > 0 || calls.length > 0)
      return {
        status: 'needs_update',
        note: 'Contact tests/calls were logged, but none outside normal business hours in the last 180 days.',
      }
    return {
      status: 'missing',
      note: 'No successfully reached contact test or logged call in the last 180 days.',
    }
  },

  sdea_contracts: async (tx, companyId) => {
    const distributorCount = await tx.distributor.count({ where: { companyId, status: 'active' } })
    if (distributorCount === 0) {
      return { status: 'ready', note: 'No active distributor relationships requiring an SDEA yet.' }
    }
    const now = new Date()
    const distributorsWithActiveSdea = await tx.sdea.groupBy({
      by: ['distributorId'],
      where: {
        companyId,
        status: 'active',
        OR: [{ expiryDate: null }, { expiryDate: { gte: now } }],
      },
    })
    if (distributorsWithActiveSdea.length >= distributorCount) return { status: 'ready' }
    return {
      status: 'missing',
      note: `${distributorCount - distributorsWithActiveSdea.length} of ${distributorCount} distributor(s) have no active, unexpired SDEA.`,
    }
  },

  annual_reconciliation: async (tx, companyId) => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 400)
    const recent = await tx.reconciliationReport.findFirst({
      where: { companyId, generatedAt: { gte: cutoff } },
    })
    return recent
      ? { status: 'ready' }
      : { status: 'missing', note: 'No reconciliation report generated in the last ~12 months.' }
  },

  ae_log: () =>
    Promise.resolve({
      status: 'ready' as const,
      note: 'Generated live from the case database at any time — see the AE log export action.',
    }),

  submission_evidence: async (tx, companyId) => {
    const [anySubmission, anyPeriodicReport] = await Promise.all([
      tx.regulatorySubmission.findFirst({ where: { companyId } }),
      tx.generatedReport.findFirst({
        where: { companyId, moduleKey: 'pv', reportTypeKey: { in: ['psur', 'pbrer'] } },
      }),
    ])
    return anySubmission || anyPeriodicReport
      ? { status: 'ready' }
      : { status: 'missing', note: 'No E2B regulatory submission or PSUR/PBRER generated yet.' }
  },

  literature_monitoring: async (tx, companyId) => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - LITERATURE_MONITORING_CURRENCY_WINDOW_DAYS)
    const recent = await tx.literatureMonitoringRun.findFirst({
      where: { companyId, runAt: { gte: cutoff } },
    })
    return recent
      ? { status: 'ready' }
      : {
          status: 'missing',
          note: `No literature-monitoring run logged in the last ${LITERATURE_MONITORING_CURRENCY_WINDOW_DAYS} days.`,
        }
  },

  /**
   * Real-usage content, 11 Sep 2026 — PPB PV Inspection Checklist §C.2
   * ("RMP Alignment"): local risk-minimization measures implemented as
   * outlined in the approved RMP. Resolved the same shape as
   * `psmf_in_place` — at least one active `RiskManagementPlan` exists
   * for any of the company's products. Doesn't (and can't yet) verify
   * the deeper "measures actually implemented as described" claim —
   * only that a real, approved RMP exists to be audited against at all.
   */
  rmp_alignment: async (tx, companyId) => {
    const active = await tx.riskManagementPlan.findFirst({ where: { companyId, status: 'active' } })
    return active
      ? { status: 'ready' }
      : { status: 'missing', note: 'No active Risk Management Plan for any product yet.' }
  },

  /**
   * Real-usage content, 11 Sep 2026 — PPB PV Inspection Checklist §B.3
   * ("Case Quality"): archived cases consistently contain the 4 minimum
   * criteria (reporter, patient, product, symptom). The Validity Gate
   * (Stage 4) already enforces this structurally at creation — no case
   * can leave Intake without meeting all four — so this resolver checks
   * the gate has genuinely been exercised (at least one real case
   * exists) rather than re-deriving the same check a second time.
   */
  case_quality_validity: async (tx, companyId) => {
    const any = await tx.case.findFirst({ where: { companyId } })
    return any
      ? {
          status: 'ready',
          note: 'Enforced structurally by the Validity Gate — no case can leave Intake without an identifiable patient, reporter, product, and reaction.',
        }
      : { status: 'missing', note: 'No cases captured yet to demonstrate this against.' }
  },

  internal_audit_capa: async (tx, companyId) => {
    const now = new Date()
    const overdue = await tx.capa.findMany({
      where: { companyId, status: { in: ['open', 'in_progress', 'pending_effectiveness_check'] } },
      select: { dueDate: true, effectivenessCheckDueAt: true },
    })
    const anyOverdue = overdue.some(
      (c) =>
        (c.dueDate && c.dueDate < now) ||
        (c.effectivenessCheckDueAt && c.effectivenessCheckDueAt < now),
    )
    if (anyOverdue)
      return {
        status: 'needs_update',
        note: 'At least one CAPA is open/awaiting its effectiveness check past its own due date.',
      }
    return { status: 'ready' }
  },

  personnel_training: async (tx, companyId) => {
    const now = new Date()
    const any = await tx.trainingRecord.findFirst({
      where: { companyId, OR: [{ expiryDate: null }, { expiryDate: { gte: now } }] },
    })
    return any
      ? { status: 'ready' }
      : {
          status: 'missing',
          note: 'No current (non-expired) training record for anyone at this company.',
        }
  },
}

@Injectable()
export class AuditReadinessService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async getDashboard(actor: AuthenticatedUser): Promise<AuditReadinessDashboard> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { homeCountryId: true, homeCountry: { select: { name: true } } },
      })
      const definitions = await tx.auditRequirementDefinition.findMany({
        where: { active: true, authority: { countryId: company.homeCountryId } },
        orderBy: { sortOrder: 'asc' },
      })
      const authorityConfigured =
        (await tx.regulatoryAuthority.count({ where: { countryId: company.homeCountryId } })) > 0

      const records = await tx.auditRequirementRecord.findMany({ where: { companyId } })
      const recordByDefinitionId = new Map(records.map((r) => [r.definitionId, r]))

      const rows: AuditRequirementRow[] = []
      for (const def of definitions) {
        const record = recordByDefinitionId.get(def.id) ?? null

        let status: AuditRequirementStatus
        let statusNote: string | null = record?.note ?? null

        if (def.source === 'system_generated') {
          const resolver = SYSTEM_RESOLVERS[def.requirementKey]
          const resolved = resolver
            ? await resolver(tx, companyId)
            : {
                status: 'missing' as const,
                note: 'No resolver implemented for this requirement yet.',
              }
          status = resolved.status
          // A human's own stored note always wins over the resolver's
          // generic explanatory note — otherwise a real override (e.g.
          // "confirmed with regulator by phone, letter pending") would be
          // permanently unreachable on any row whose resolver always
          // returns a note of its own (several system_generated rows do).
          statusNote = record?.note ?? resolved.note ?? null
        } else {
          status = record?.status ?? 'missing'
        }

        rows.push({
          definitionId: def.id,
          requirementKey: def.requirementKey,
          sortOrder: def.sortOrder,
          title: def.title,
          description: def.description,
          source: def.source,
          evidenceArtifactType: def.evidenceArtifactType,
          isMandatory: def.isMandatory,
          status,
          statusNote,
          evidenceDocumentId: record?.evidenceDocumentId ?? null,
          lastVerifiedAt: record?.lastVerifiedAt ?? null,
          nextDueAt: record?.nextDueAt ?? null,
          checklistJson: record?.checklistJson ?? null,
        })
      }

      const mandatoryRows = rows.filter((r) => r.isMandatory)
      const readyCount = mandatoryRows.filter((r) => r.status === 'ready').length
      const missingCount = mandatoryRows.filter((r) => r.status === 'missing').length

      // testing-todo Stage 16.2-A — `readyCount === mandatoryRows.length`
      // is vacuously true when there are zero mandatory rows at all (no
      // requirements configured for this company's home country yet),
      // which previously reported a misleading "green" (fully ready) for
      // a company that has had nothing evaluated whatsoever. Guarded
      // explicitly rather than relying on the 0 === 0 coincidence.
      let overall: 'green' | 'amber' | 'red'
      if (mandatoryRows.length === 0) overall = 'red'
      else if (missingCount > 0) overall = 'red'
      else if (readyCount === mandatoryRows.length) overall = 'green'
      else overall = 'amber'

      return {
        overall,
        readyCount,
        totalMandatory: mandatoryRows.length,
        rows,
        homeCountryName: company.homeCountry.name,
        authorityConfigured,
      }
    })
  }

  /**
   * For `person_uploads` rows this is the real, only source of truth.
   * For `system_generated` rows this only ever stores a human override
   * note/checklist — the live-resolved `status` in `getDashboard()`
   * always wins over anything stored here, matching
   * `AuditRequirementRecord`'s own doc comment.
   */
  async updateRecord(
    actor: AuthenticatedUser,
    definitionId: string,
    dto: UpdateAuditRequirementDto,
    meta: RequestMeta,
  ): Promise<void> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const definition = await tx.auditRequirementDefinition.findUnique({
        where: { id: definitionId },
      })
      if (!definition) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Audit requirement not found' })
      }

      if (dto.documentId) {
        const document = await tx.document.findFirst({ where: { id: dto.documentId, companyId } })
        if (!document) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: 'Evidence document not found for this company',
          })
        }
      }

      const existing = await tx.auditRequirementRecord.findUnique({
        where: { companyId_definitionId: { companyId, definitionId } },
      })

      const checklistJson: Prisma.InputJsonValue | typeof Prisma.JsonNull =
        dto.checklistJson !== undefined
          ? (dto.checklistJson as Prisma.InputJsonValue)
          : ((existing?.checklistJson as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull)

      const data = {
        status:
          definition.source === 'person_uploads'
            ? (dto.status ?? existing?.status ?? 'missing')
            : (existing?.status ?? 'missing'),
        evidenceDocumentId: dto.documentId ?? existing?.evidenceDocumentId ?? null,
        note: dto.note ?? existing?.note ?? null,
        checklistJson,
        lastVerifiedAt: new Date(),
        updatedBy: actor.sub,
      }

      await tx.auditRequirementRecord.upsert({
        where: { companyId_definitionId: { companyId, definitionId } },
        create: { id: newId(), companyId, definitionId, ...data },
        update: data,
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'audit_requirement_updated',
        recordType: AUDIT_REQUIREMENT_RECORD_TYPE,
        recordId: definitionId,
        newValue: {
          requirementKey: definition.requirementKey,
          status: data.status,
          hasDocument: !!data.evidenceDocumentId,
        },
        ip: meta.ip,
      })
    })
  }

  /** Row 10 — "generated live from the case database, exportable" — a plain CSV, no stored artifact. */
  async exportAeLogCsv(actor: AuthenticatedUser): Promise<string> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const cases = await tx.case.findMany({
        where: { companyId },
        orderBy: { receivedDate: 'desc' },
        select: { referenceNumber: true, receivedDate: true, status: true, seriousnessClass: true },
      })

      const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
      const header = ['Reference', 'Received Date', 'Status', 'Seriousness'].join(',')
      const lines = cases.map((c) =>
        [
          c.referenceNumber,
          c.receivedDate.toISOString().slice(0, 10),
          c.status,
          c.seriousnessClass ?? '',
        ]
          .map((v) => escape(String(v)))
          .join(','),
      )
      return [header, ...lines].join('\n')
    })
  }
}
