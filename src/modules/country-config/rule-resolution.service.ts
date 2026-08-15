import { Injectable } from '@nestjs/common'
import { FormSchema, ReportingRule } from '@prisma/client'

import { PrismaService } from '../../prisma/prisma.service'

/**
 * Pure, deterministic resolution of "what rule/form applies right now (or
 * as of some past date)" — this is the function that computes legal
 * reporting deadlines (Phase 5.3 consumes `resolveReportingRule` directly),
 * so it gets the heaviest test coverage in the codebase. No side effects,
 * no writes — every method is a read-only lookup.
 *
 * A version only ever becomes `active` via `CountryConfigService.activate*`,
 * which always retires whatever was previously active for the same natural
 * key in the same transaction — so at most one row is `active` at any
 * instant, and `retired` rows keep their `effectiveFrom` for historical
 * lookups. Resolving "as of" a past date therefore looks across BOTH
 * `active` and `retired` rows and picks the one whose `effectiveFrom` is
 * the latest that still doesn't exceed `asOfDate` — this is what makes a
 * case's deadline correctly reflect the rule that applied when the event
 * happened, even after the rule has since changed.
 */
@Injectable()
export class RuleResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveReportingRule(
    authorityId: string,
    reportTypeId: string,
    seriousnessClass: string,
    asOfDate: Date,
  ): Promise<ReportingRule | null> {
    const candidates = await this.prisma.reportingRule.findMany({
      where: {
        authorityId,
        reportTypeId,
        seriousnessClass,
        status: { in: ['active', 'retired'] },
        effectiveFrom: { lte: asOfDate },
      },
      orderBy: { effectiveFrom: 'desc' },
      take: 1,
    })

    return candidates[0] ?? null
  }

  async resolveFormSchema(
    countryId: string | null,
    reportTypeId: string,
  ): Promise<FormSchema | null> {
    if (countryId) {
      const countrySpecific = await this.findActiveAsOf(countryId, reportTypeId, new Date())
      if (countrySpecific) return countrySpecific
    }
    return this.findActiveAsOf(null, reportTypeId, new Date())
  }

  private async findActiveAsOf(
    countryId: string | null,
    reportTypeId: string,
    asOfDate: Date,
  ): Promise<FormSchema | null> {
    const candidates = await this.prisma.formSchema.findMany({
      where: {
        countryId,
        reportTypeId,
        status: { in: ['active', 'retired'] },
        effectiveFrom: { lte: asOfDate },
      },
      orderBy: { effectiveFrom: 'desc' },
      take: 1,
    })
    return candidates[0] ?? null
  }
}
