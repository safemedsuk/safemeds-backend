import { Injectable, NotFoundException } from '@nestjs/common'
import { RegDeadlineRule, RegulatoryFeeSchedule } from '@prisma/client'

import { PrismaService } from '../../prisma/prisma.service'
import { RegConfigService, RegulatoryRequirementWithDocs } from './reg-config.service'

export interface ClassificationPreview {
  requirement: RegulatoryRequirementWithDocs | null
  feeSchedules: RegulatoryFeeSchedule[]
  /** The renewal-cadence rule (`obligationType: 'renewal'`) for this combination, if one is active — a preview of what Stage 0.4's engine will compute once a real registration exists. */
  renewalRule: RegDeadlineRule | null
  /** Plain-language flags surfaced to the tenant *before* they commit to a dossier, not buried in a schema field — the whole reason a country rule-set graph exists is to make an unverified/unconfigured combination visible up front rather than discovered mid-compilation. */
  warnings: string[]
}

/**
 * RegCloud (Phase 12) Stage 1 — Classify & Plan. A pure, read-only
 * aggregation over Stage 0.1's own `RegConfigService.resolveRequirement()`/
 * `resolveFeeSchedules()`/`resolveDeadlineRule()` — deliberately no new
 * database model (`todo-regcloud.md`'s own Stage 1 bullet explicitly
 * offers "fold into `RegDossier`'s own `status: planning` state" as the
 * alternative to a standalone `RegistrationPlan` table, and that's the
 * path taken here: the *classification decision* is just the
 * country/authority/productClass/route a tenant picks, captured directly
 * as `RegDossier`'s own columns once they commit — see
 * `RegDossierService.create()`). This service exists purely so the
 * classification wizard can show a live "here's what you'll need" preview
 * *before* that commitment, reusing the exact same resolution logic the
 * real dossier-creation flow will use a moment later — never a second,
 * parallel resolution path that could drift from it.
 */
@Injectable()
export class ClassificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regConfigService: RegConfigService,
  ) {}

  /** `countryId` is deliberately not a caller-supplied parameter — it's always derived from the chosen authority, so a caller can never pass a mismatched country/authority pair by mistake. */
  async classify(
    authorityId: string,
    productClass: string,
    route: string,
  ): Promise<ClassificationPreview> {
    const authority = await this.prisma.regulatoryAuthority.findUnique({
      where: { id: authorityId },
    })
    if (!authority)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Regulatory authority not found' })

    const [requirement, feeSchedules, renewalRule] = await Promise.all([
      this.regConfigService.resolveRequirement(
        authority.countryId,
        authorityId,
        productClass,
        route,
      ),
      this.regConfigService.resolveFeeSchedules(
        authority.countryId,
        authorityId,
        productClass,
        route,
      ),
      this.regConfigService.resolveDeadlineRule(
        authority.countryId,
        authorityId,
        productClass,
        'renewal',
      ),
    ])

    const warnings: string[] = []
    if (!requirement) {
      warnings.push(
        'No document checklist is configured yet for this country/authority/product class — you can still start a dossier, but it will begin with zero pre-filled requirements.',
      )
    } else if (requirement.unverified) {
      warnings.push(
        'The document checklist shown has not yet been confirmed against a primary regulatory source.',
      )
    }
    if (feeSchedules.some((f) => f.unverified)) {
      warnings.push('One or more fee amounts shown are placeholder figures, not yet confirmed.')
    }
    if (renewalRule?.unverified) {
      warnings.push('The renewal cadence shown has not yet been confirmed.')
    }

    return { requirement, feeSchedules, renewalRule, warnings }
  }
}
