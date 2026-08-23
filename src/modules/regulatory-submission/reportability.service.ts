import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Deadline, Prisma, RegulatoryAuthority } from '@prisma/client'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { PV_CASE_RECORD_TYPE } from '../pv/pv-case.service'

export interface ReportabilityResult {
  reportable: boolean
  isForeign: boolean
  reason: string
  authority: RegulatoryAuthority | null
  deadline: Deadline | null
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

/**
 * VigiCloud Stage 12 — "given a case's seriousness/country/report-type,
 * determine whether it's individually reportable at all," per the
 * confirmed domain rule already recorded in CLAUDE.md: a case is
 * "foreign" (occurrence country ≠ report country) is **never**
 * individually reported — it's folded into the periodic PSUR/PBRER
 * instead, per GUD/022 §6.1. Genuinely local cases are reportable
 * exactly when Stage 5's own `TriageService.classify()` already
 * resolved a real `Deadline` — this service doesn't re-derive that
 * logic, it just checks the answer Stage 5 already computed, mirroring
 * `TriageService.resolveAuthority()`'s own authority-lookup shape.
 */
@Injectable()
export class ReportabilityService {
  constructor(private readonly rls: RlsService) {}

  async assess(actor: AuthenticatedUser, caseId: string): Promise<ReportabilityResult> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const pvCase = await tx.case.findFirst({ where: { id: caseId, companyId } })
      if (!pvCase) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'PV case not found' })
      }

      const isForeign = pvCase.countryOfOccurrenceId !== pvCase.countryOfReportId
      if (isForeign) {
        return {
          reportable: false,
          isForeign: true,
          reason:
            'Foreign case (the occurrence country differs from the report country) — not individually reported; folded into the periodic PSUR/PBRER instead, per GUD/022 §6.1.',
          authority: null,
          deadline: null,
        }
      }

      const authority = await this.resolveAuthority(
        tx,
        pvCase.countryOfReportId,
        pvCase.reportTypeId,
      )
      const deadline = await tx.deadline.findUnique({
        where: { recordType_recordId: { recordType: PV_CASE_RECORD_TYPE, recordId: caseId } },
      })

      if (!authority || !deadline) {
        return {
          reportable: false,
          isForeign: false,
          reason:
            'No confirmed reporting rule resolves yet for this report type/seriousness — classify (triage) the case first.',
          authority: authority ?? null,
          deadline: null,
        }
      }

      return {
        reportable: true,
        isForeign: false,
        reason:
          'Local case with a confirmed reporting rule and computed deadline — individually reportable.',
        authority,
        deadline,
      }
    })
  }

  /** Mirrors `TriageService.resolveAuthority()`'s own shape exactly — a country can have more than one regulatory authority, and which one owns a given report type is only knowable by which one has an active `ReportingRule` naming it. */
  private async resolveAuthority(
    tx: Prisma.TransactionClient,
    countryId: string,
    reportTypeId: string,
  ): Promise<RegulatoryAuthority | null> {
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
