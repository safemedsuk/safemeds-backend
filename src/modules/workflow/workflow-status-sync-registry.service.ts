import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

export interface StatusSyncContext {
  tx: Prisma.TransactionClient
  recordId: string
  toStateKey: string
  /** RegCloud Stage 6 — needed by a sync function that performs a real domain write scoped to a company (e.g. creating a `ProductRegistration`), not just updating a column on the record it already has by id. */
  companyId: string
  /** Null for a system-triggered transition (there are none of these today, but `WorkflowService.transition()` itself is always actor-driven, so this is realistically always set). */
  actorUserId?: string
  /** RegCloud Stage 6 — the caller-supplied `PostTransitionDto.payload`, if any. See that DTO's own doc comment for the full reasoning; most sync functions ignore it. */
  payload?: Record<string, unknown>
}

export type StatusSyncFn = (ctx: StatusSyncContext) => Promise<void>

/**
 * A small, generic extension point on top of the otherwise fully
 * domain-agnostic `WorkflowService`, mirroring
 * `WorkflowGuardRegistryService`'s own shape exactly. A domain module
 * registers a sync function against a `recordType` at startup;
 * `WorkflowService.transition()` calls it, inside the same transaction
 * as the transition itself, immediately after the `WorkflowInstance`
 * moves — so a domain record's own denormalized `status` column (kept
 * for list/export query performance, per `Case.status`'s and
 * `Signal.status`'s own schema doc comments) never silently drifts
 * from the real workflow state.
 *
 * This closes a real, previously-shipped gap: before this registry
 * existed, nothing ever wrote to `Case.status`/`Signal.status` after
 * creation — `get()` on both worked around it by reading the live
 * `WorkflowInstance.currentState` directly, but every `list()`/export/
 * joined-record read (PV Cases list, the AE log CSV export, PV Signals
 * list, a signal's own linked-Evidence-Cases join) trusted the column
 * as documented, and so showed every record permanently stuck at its
 * *creation-time* state forever. Registering a sync function here is
 * the fix those doc comments always assumed would eventually land.
 *
 * RegCloud Stage 6 generalizes what a registered function is allowed to
 * *do*, without changing this registry's own shape at all: `StatusSyncFn`
 * always ran inside the transition's own atomic transaction with full
 * write access to `tx`, so nothing here ever actually restricted a
 * registration to "only touch a status column" — `RegWorkflowGuards`'
 * own `reg_registration` function is the first to lean on that, creating
 * a real `ProductRegistration` row (Stage 6) or updating one (Stage 7's
 * renewal/variation approval) as part of the exact same atomic write
 * that moves the dossier's workflow state, using `ctx.payload` for
 * whatever caller-supplied data that domain action needs.
 */
@Injectable()
export class WorkflowStatusSyncRegistryService {
  private readonly syncs = new Map<string, StatusSyncFn>()

  register(recordType: string, fn: StatusSyncFn): void {
    this.syncs.set(recordType, fn)
  }

  async sync(recordType: string, ctx: StatusSyncContext): Promise<void> {
    const fn = this.syncs.get(recordType)
    if (fn) await fn(ctx)
  }
}
