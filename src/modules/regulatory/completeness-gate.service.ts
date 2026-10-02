import { ForbiddenException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'

export interface CompletenessSlotResult {
  slotId: string
  label: string
  ctdModule: string | null
  isMandatory: boolean
  attached: boolean
  met: boolean
}

export interface CompletenessGateResult {
  allowed: boolean
  /**
   * testing-correction-explanation.md §1.2 — true when this dossier is
   * wrapped by a `RegVariation` (a variation, or a renewal — `RegVariation
   * .variationType === 'renewal'`), meaning the checklist below is shown
   * for guidance only and can never block a transition. Only a fresh
   * registration dossier (no wrapping `RegVariation`) still enforces
   * mandatory documents — the checklist configured in the admin console
   * was always meant for *registration*, never for what a variation/
   * renewal/retention actually needs, which differs per case and isn't
   * something a fixed per-product-class list can honestly represent.
   */
  guidanceOnly: boolean
  slots: CompletenessSlotResult[]
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A dossier is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * RegCloud (Phase 12) Stage 3 — the flagship "catch an incomplete dossier
 * before it ever reaches the regulator" gate, per the Build Priority
 * doc's own framing. Deliberately generous, mirroring
 * `ValidityGateService`'s exact design philosophy (VigiCloud Stage 4):
 * only a slot backed by a *mandatory* `RequiredDocumentDefinition` can
 * ever fail this gate — an ad-hoc slot (`requiredDocumentDefinitionId:
 * null`, added via `addSlot()` for a document the checklist didn't
 * anticipate) is never itself a blocker, since it was never part of the
 * resolved requirement in the first place; a dossier with zero slots at
 * all (an unconfigured market, per Stage 0.3's own graceful-degradation
 * rule) passes trivially, for the same reason `RegDossierService.create()`
 * never blocks on one.
 *
 * Format-level validation beyond "is the required document present"
 * (page limits, file size, language, notarization markers) is explicitly
 * out of scope for this pass — `todo-regcloud.md`'s own Stage 3 bullet
 * flags this as needing field-expert confirmation, and none of it is
 * sourced in `regcloud docs/` yet.
 */
@Injectable()
export class CompletenessGateService {
  constructor(private readonly rls: RlsService) {}

  async evaluate(actor: AuthenticatedUser, dossierId: string): Promise<CompletenessGateResult> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) => this.evaluateInTx(tx, dossierId))
  }

  /** For callers already inside an RLS-bound transaction (e.g. `WorkflowGuardRegistryService`'s guard context, or `RegDossierService.get()`'s own single fetch). */
  async evaluateInTx(
    tx: Prisma.TransactionClient,
    dossierId: string,
  ): Promise<CompletenessGateResult> {
    const [slots, wrappingVariation] = await Promise.all([
      tx.regDossierDocumentSlot.findMany({
        where: { regDossierId: dossierId },
        include: { requiredDocumentDefinition: true },
        orderBy: { createdAt: 'asc' },
      }),
      // testing-correction-explanation.md §1.2 — the same real signal
      // `RegWorkflowGuards`' own status-sync function already trusts:
      // only a genuine `RegVariation` row proves this dossier is a
      // variation/renewal, never `RegDossier.productRegistrationId` alone.
      tx.regVariation.findFirst({ where: { regDossierId: dossierId }, select: { id: true } }),
    ])
    const guidanceOnly = wrappingVariation !== null

    const results: CompletenessSlotResult[] = slots.map((slot) => {
      const isMandatory = !guidanceOnly && (slot.requiredDocumentDefinition?.isMandatory ?? false)
      const attached = slot.documentId !== null
      return {
        slotId: slot.id,
        label: slot.requiredDocumentDefinition?.name ?? slot.labelOverride ?? 'Untitled document',
        ctdModule: slot.ctdModule,
        isMandatory,
        attached,
        met: guidanceOnly || !isMandatory || attached,
      }
    })

    return { allowed: guidanceOnly || results.every((r) => r.met), guidanceOnly, slots: results }
  }
}
