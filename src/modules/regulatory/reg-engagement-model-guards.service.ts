import { Injectable, OnModuleInit } from '@nestjs/common'

import { WorkflowGuardRegistryService } from '../workflow/workflow-guard-registry.service'
import { EngagementModelService } from './engagement-model.service'
import { REG_REGISTRATION_RECORD_TYPE } from './reg-dossier.service'

/**
 * RegCloud (Phase 12) Stage 15 — Modular Engagement Model. Adds two
 * ADDITIONAL guards on the same `(reg_registration, fromStateKey)` pairs
 * `RegWorkflowGuards` already gates — `WorkflowGuardRegistryService`
 * runs every registered guard for a pair, so this doesn't replace or
 * conflict with the existing completeness/evidence/query guards, it just
 * adds one more condition for the two engagement types where SafeMeds
 * *isn't* the one performing the action:
 *
 * - `dossier_review_only` ("the client submits themselves"): the
 *   `completeness_check → submitted` transition already requires real
 *   dispatch evidence (`RegWorkflowGuards`'s own Stage 4 guard) — this
 *   adds a documented acknowledgement of *who* actually dispatched it,
 *   since it wasn't SafeMeds.
 * - `client_handles_queries` ("the client fields regulator questions
 *   directly"): the `responding → resubmitted_for_review` transition
 *   gets the same acknowledgement requirement, covering the case where
 *   `RegQueryService.respond()` was called with a note instead of a
 *   response document (see that service's own doc comment).
 *
 * Deliberately reuses the exact `requireNote`-style mechanism VigiCloud
 * Stage 17's `SignalWorkflowGuards` already established — no new gating
 * primitive, and deliberately **no `REGULATORY_AFFAIRS_OFFICER` role
 * split** — `todo-regcloud.md`'s own Stage 15 text explicitly warns
 * against building that speculatively before real access-pattern needs
 * are observable.
 */
@Injectable()
export class RegEngagementModelGuards implements OnModuleInit {
  constructor(
    private readonly guardRegistry: WorkflowGuardRegistryService,
    private readonly engagementModelService: EngagementModelService,
  ) {}

  onModuleInit(): void {
    this.guardRegistry.register(
      REG_REGISTRATION_RECORD_TYPE,
      'completeness_check',
      async ({ tx, companyId, recordId, toStateKey, note }) => {
        if (toStateKey !== 'submitted') return { allowed: true }
        const effective = await this.engagementModelService.resolveEffective(
          tx,
          companyId,
          recordId,
        )
        if (effective !== 'dossier_review_only') return { allowed: true }
        if (note && note.trim().length > 0) return { allowed: true }
        return {
          allowed: false,
          reason:
            'This dossier is engaged as "dossier review only" — the client submits it themselves. Confirm who dispatched it with a short note before marking it Submitted.',
        }
      },
    )

    this.guardRegistry.register(
      REG_REGISTRATION_RECORD_TYPE,
      'responding',
      async ({ tx, companyId, recordId, toStateKey, note }) => {
        if (toStateKey !== 'resubmitted_for_review') return { allowed: true }
        const effective = await this.engagementModelService.resolveEffective(
          tx,
          companyId,
          recordId,
        )
        if (effective !== 'client_handles_queries') return { allowed: true }
        if (note && note.trim().length > 0) return { allowed: true }
        return {
          allowed: false,
          reason:
            'This dossier is engaged as "client handles queries" — the client fields regulator questions directly. Confirm how the query was resolved with a short note before resubmitting for review.',
        }
      },
    )
  }
}
