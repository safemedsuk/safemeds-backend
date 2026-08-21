import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { AdverseEvent, Case, Deadline, Prisma } from '@prisma/client'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DeadlineService } from '../workflow/deadline.service'
import { ClassifyCaseDto } from './dto/classify-case.dto'
import { PV_CASE_RECORD_TYPE, RequestMeta } from './pv-case.service'

export type SeriousnessClass = 'fatal' | 'serious' | 'non_serious'

export interface ClassifyResult {
  case: Case
  deadline: Deadline | null
  /** True when a deadline genuinely could not be computed — no active, verified `ReportingRule` resolves yet for this report type/seriousness (real today for `quality_complaint`/`medication_error`/`transfusion_reaction`, whose only seeded candidates are `unverified: true`). Distinguishes "the case is classified but the clock hasn't started because we don't have a confirmed rule" from a bug. */
  deadlineUnavailable: boolean
}

/** Only `adr` currently has a real three-tier (fatal/serious/non_serious) scheme seeded — every other report type (device_incident, quality_complaint, medication_error, transfusion_reaction) only ever resolves to serious/non_serious, per `country-rules.seed-data.ts`. A `death` flag on a non-ADR case's event still means the case is serious, just not the more severe "fatal" tier that doesn't exist for that report type. */
const THREE_TIER_REPORT_TYPES = new Set(['adr'])

/** Pure — the "triage judgment" the `AdverseEvent.seriousnessX` flags' own schema doc comment anticipates: the worst classification across every event on the case, not a re-statement of any single one. */
export function deriveSeriousnessClass(
  adverseEvents: Pick<
    AdverseEvent,
    | 'seriousnessDeath'
    | 'seriousnessLifeThreatening'
    | 'seriousnessHospitalization'
    | 'seriousnessDisabling'
    | 'seriousnessCongenitalAnomaly'
    | 'seriousnessOther'
  >[],
  reportTypeKey: string,
): SeriousnessClass {
  const anyDeath = adverseEvents.some((e) => e.seriousnessDeath)
  const anySerious = adverseEvents.some(
    (e) =>
      e.seriousnessDeath ||
      e.seriousnessLifeThreatening ||
      e.seriousnessHospitalization ||
      e.seriousnessDisabling ||
      e.seriousnessCongenitalAnomaly ||
      e.seriousnessOther,
  )

  if (anyDeath && THREE_TIER_REPORT_TYPES.has(reportTypeKey)) return 'fatal'
  if (anySerious) return 'serious'
  return 'non_serious'
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'PV cases are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

function isErrorWithCode(error: unknown, code: string): boolean {
  if (!(error instanceof NotFoundException || error instanceof ConflictException)) return false
  const response = error.getResponse()
  return (
    typeof response === 'object' &&
    response !== null &&
    (response as { code?: string }).code === code
  )
}

/**
 * VigiCloud Stage 5 — `TriageService.classify()` derives (or accepts an
 * explicit override of) the case's seriousness, persists it, and
 * computes/recomputes the real legal reporting deadline through the
 * already-built Phase 5.3 machinery (`DeadlineService`/
 * `RuleResolutionService`) — this is real reuse, not new deadline
 * infrastructure. Callable at any point after intake, not just once —
 * "reclassification (seriousness changes mid-case) triggers
 * `DeadlineService.recompute()`" per the todo doc, so re-running this
 * later with new information is the expected, normal path, not an edge
 * case.
 */
@Injectable()
export class TriageService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly deadlineService: DeadlineService,
  ) {}

  async classify(
    actor: AuthenticatedUser,
    caseId: string,
    dto: ClassifyCaseDto,
    meta: RequestMeta,
  ): Promise<ClassifyResult> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const pvCase = await tx.case.findFirst({
        where: { id: caseId, companyId },
        include: { adverseEvents: true, reportType: true },
      })
      if (!pvCase) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'PV case not found' })
      }

      const seriousnessClass =
        dto.seriousnessClass ??
        deriveSeriousnessClass(pvCase.adverseEvents, pvCase.reportType.typeKey)
      const oldSeriousnessClass = pvCase.seriousnessClass

      const updatedCase = await tx.case.update({
        where: { id: caseId },
        data: { seriousnessClass },
      })

      const authority = await this.resolveAuthority(
        tx,
        pvCase.countryOfReportId,
        pvCase.reportTypeId,
      )
      let deadline: Deadline | null = null
      let deadlineUnavailable = false

      if (authority) {
        try {
          const existingDeadline = await tx.deadline.findUnique({
            where: { recordType_recordId: { recordType: PV_CASE_RECORD_TYPE, recordId: caseId } },
          })

          deadline = existingDeadline
            ? await this.deadlineService.recompute(
                actor,
                existingDeadline.id,
                seriousnessClass,
                pvCase.awarenessDate,
                meta,
              )
            : await this.deadlineService.computeFor(
                actor,
                {
                  companyId,
                  recordType: PV_CASE_RECORD_TYPE,
                  recordId: caseId,
                  authorityId: authority.id,
                  reportTypeId: pvCase.reportTypeId,
                  seriousnessClass,
                  awarenessDate: pvCase.awarenessDate,
                },
                meta,
              )
        } catch (error) {
          // No active/verified rule resolves yet for this report type —
          // real today for quality_complaint/medication_error/
          // transfusion_reaction (see CLAUDE.md's domain-knowledge
          // section: their only seeded candidates are `unverified: true`,
          // structurally blocked from ever going `active`). The case is
          // still genuinely classified; the clock just hasn't started,
          // exactly like Stage 4's own "holds at zero" framing for the
          // four minimum criteria, extended here to "holds at zero until
          // a confirmed rule exists."
          if (
            isErrorWithCode(error, 'NO_ACTIVE_RULE') ||
            isErrorWithCode(error, 'RULE_UNVERIFIED')
          ) {
            deadlineUnavailable = true
          } else {
            throw error
          }
        }
      } else {
        deadlineUnavailable = true
      }

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'pv_case_triaged',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: caseId,
        oldValue: { seriousnessClass: oldSeriousnessClass },
        newValue: {
          seriousnessClass,
          deadlineId: deadline?.id ?? null,
          dueAt: deadline?.dueAt.toISOString() ?? null,
        },
        ip: meta.ip,
      })

      return { case: updatedCase, deadline, deadlineUnavailable }
    })
  }

  /** Mirrors `CountryConfigService.getConfigTree()`'s own authority-resolution signal: a country can have more than one regulatory authority (e.g. Kenya's PPB and NVIP/DHIS2), and which one actually owns a given report type is only knowable by which one has an active `ReportingRule` naming it — never assumed from country alone. */
  private async resolveAuthority(
    tx: Prisma.TransactionClient,
    countryId: string,
    reportTypeId: string,
  ) {
    const authorities = await tx.regulatoryAuthority.findMany({ where: { countryId } })
    for (const authority of authorities) {
      const hasRule = await tx.reportingRule.findFirst({
        where: { authorityId: authority.id, reportTypeId, status: 'active' },
      })
      if (hasRule) return authority
    }
    return null
  }
}
