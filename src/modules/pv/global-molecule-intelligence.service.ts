import { ForbiddenException, Injectable } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { PV_CASE_RECORD_TYPE, RequestMeta } from './pv-case.service'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Molecule intelligence is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

export interface OwnMoleculeCaseSummary {
  totalCases: number
  byCountry: { countryId: string; countryName: string; caseCount: number }[]
  bySeriousness: { seriousnessClass: string | null; caseCount: number }[]
  byMonth: { month: string; caseCount: number }[]
}

export interface MoleculeIntelligenceView {
  moleculeName: string
  own: OwnMoleculeCaseSummary
}

/**
 * VigiCloud Stage 19 — "Global Molecule Intelligence: a per-molecule
 * cross-market performance view." Originally shipped with a second,
 * cross-portfolio half (how many *other* SafeMeds tenants' cases exist
 * for the same molecule) — a narrow, count-only, audited cross-tenant
 * read, mirroring Stage 15's `ReconciliationService.crossTenantSummary()`
 * precedent. **Deliberately removed 17 Aug 2026 (testing-todo 19.1)**:
 * a real product decision that showing *any* cross-company statistics to
 * another SafeMeds tenant — even count-only, anonymized, never another
 * tenant's identity or case content — is not acceptable and risks client
 * trust. This is now purely a tenant-scoped read: this company's own
 * cases for the molecule, broken down by country/seriousness/month.
 */
@Injectable()
export class GlobalMoleculeIntelligenceService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  /** For the molecule picker — every distinct active-substance name this tenant has ever named on a suspect product. */
  async listOwnMolecules(actor: AuthenticatedUser): Promise<string[]> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const rows = await tx.suspectProduct.findMany({
        where: { companyId, activeSubstanceName: { not: null } },
        select: { activeSubstanceName: true },
        distinct: ['activeSubstanceName'],
      })
      return rows
        .map((r) => r.activeSubstanceName!)
        .filter((name) => name.trim().length > 0)
        .sort((a, b) => a.localeCompare(b))
    })
  }

  async getMoleculeView(
    actor: AuthenticatedUser,
    moleculeName: string,
    meta: RequestMeta,
  ): Promise<MoleculeIntelligenceView> {
    const companyId = requireCompany(actor)
    const trimmedName = moleculeName.trim()

    const own = await this.rls.runAsCompany(companyId, async (tx) => {
      const cases = await tx.case.findMany({
        where: {
          companyId,
          suspectProducts: {
            some: { activeSubstanceName: { equals: trimmedName, mode: 'insensitive' } },
          },
        },
        select: {
          id: true,
          countryOfOccurrenceId: true,
          seriousnessClass: true,
          receivedDate: true,
          countryOfOccurrence: { select: { name: true } },
        },
      })

      const byCountryMap = new Map<string, { countryName: string; caseCount: number }>()
      const bySeriousnessMap = new Map<string | null, number>()
      const byMonthMap = new Map<string, number>()

      for (const c of cases) {
        const country = byCountryMap.get(c.countryOfOccurrenceId) ?? {
          countryName: c.countryOfOccurrence.name,
          caseCount: 0,
        }
        country.caseCount += 1
        byCountryMap.set(c.countryOfOccurrenceId, country)

        bySeriousnessMap.set(
          c.seriousnessClass,
          (bySeriousnessMap.get(c.seriousnessClass) ?? 0) + 1,
        )

        const month = c.receivedDate.toISOString().slice(0, 7)
        byMonthMap.set(month, (byMonthMap.get(month) ?? 0) + 1)
      }

      return {
        totalCases: cases.length,
        byCountry: [...byCountryMap.entries()]
          .map(([countryId, v]) => ({
            countryId,
            countryName: v.countryName,
            caseCount: v.caseCount,
          }))
          .sort((a, b) => b.caseCount - a.caseCount),
        bySeriousness: [...bySeriousnessMap.entries()].map(([seriousnessClass, caseCount]) => ({
          seriousnessClass,
          caseCount,
        })),
        byMonth: [...byMonthMap.entries()]
          .map(([month, caseCount]) => ({ month, caseCount }))
          .sort((a, b) => a.month.localeCompare(b.month)),
      }
    })

    await this.rls.runAsCompany(companyId, (tx) =>
      this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'molecule_intelligence_queried',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: null,
        newValue: { moleculeName: trimmedName, ownCaseCount: own.totalCases },
        ip: meta.ip,
      }),
    )

    return { moleculeName: trimmedName, own }
  }
}
