import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

export const ENGAGEMENT_TYPES = [
  'full_service',
  'dossier_review_only',
  'client_handles_queries',
] as const
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number]

/**
 * RegCloud (Phase 12) Stage 15 — Modular Engagement Model. The single
 * place "what engagement type actually governs this dossier right now"
 * is resolved — a dossier's own `engagementType` override, falling back
 * to the company's `Company.engagementType` default. Deliberately never
 * denormalized onto the dossier at create time (see `RegDossier
 * .engagementType`'s own schema doc comment) — always resolved live, so
 * a company-level default change is reflected immediately for every
 * dossier that hasn't set its own override, matching this project's own
 * "don't persist what can be computed live" discipline.
 */
@Injectable()
export class EngagementModelService {
  async resolveEffective(
    tx: Prisma.TransactionClient,
    companyId: string,
    dossierId?: string | null,
  ): Promise<EngagementType> {
    if (dossierId) {
      const dossier = await tx.regDossier.findUnique({
        where: { id: dossierId },
        select: { engagementType: true },
      })
      if (dossier?.engagementType) return dossier.engagementType as EngagementType
    }
    const company = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { engagementType: true },
    })
    return company.engagementType as EngagementType
  }
}
