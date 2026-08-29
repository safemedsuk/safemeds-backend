import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

export interface TransitionGuardContext {
  tx: Prisma.TransactionClient
  companyId: string
  recordId: string
  /** The state this transition would land in — lets a guard apply only to specific outgoing transitions from the same `fromStateKey` (e.g. Stage 9's four-eyes check only cares about the "approve forward" transition, not a "reject back" one leaving the same state). */
  toStateKey: string
  /** Who is attempting the transition — needed by any guard that checks *who*, not just *what* (e.g. Stage 9's four-eyes rule). */
  actorUserId: string
  /** VigiCloud Stage 17 — the caller-supplied `PostTransitionDto.note`, if any. A guard that requires a documented rationale (e.g. `SignalWorkflowGuards`) checks this directly; most guards ignore it. */
  note?: string
  /** RegCloud Stage 6 — the caller-supplied `PostTransitionDto.payload`, if any. A guard needing extra structured data present before allowing a transition (e.g. a registration number before `→ approved`) validates it directly; most guards ignore it. See `PostTransitionDto.payload`'s own doc comment for the full reasoning. */
  payload?: Record<string, unknown>
}

export interface TransitionGuardResult {
  allowed: boolean
  /** Surfaced verbatim in the `TRANSITION_NOT_ALLOWED` error when `allowed` is false — must be meaningful to whoever is trying to act on the record, not an internal code. */
  reason?: string
}

export type TransitionGuardFn = (ctx: TransitionGuardContext) => Promise<TransitionGuardResult>

/**
 * VigiCloud Stage 3.7 — a small, generic extension point on top of the
 * otherwise fully domain-agnostic `WorkflowService`. A domain module
 * (e.g. `PvModule`) registers a guard against a specific
 * `(recordType, fromStateKey)` pair at startup; `WorkflowService.transition()`
 * checks every registered guard for that pair before allowing the
 * transition through, regardless of role/signature requirements already
 * being satisfied. This is deliberately the *only* domain-specific hook
 * `WorkflowService` exposes — it stays otherwise ignorant of what a
 * `pv_case`, a `deviation`, or any other record type actually is.
 *
 * Stage 4's `ValidityGateService` (the four-minimum-criteria check on
 * the same Intake→Triage transition) is expected to register its own
 * guard through this exact registry rather than building a second,
 * parallel gating mechanism — this is the "workflow engine's existing
 * transition-gating mechanism" the todo doc's Stage 3.7/Stage 4 bullets
 * both reference.
 */
@Injectable()
export class WorkflowGuardRegistryService {
  private readonly guards = new Map<string, TransitionGuardFn[]>()

  register(recordType: string, fromStateKey: string, guard: TransitionGuardFn): void {
    const key = this.key(recordType, fromStateKey)
    const existing = this.guards.get(key) ?? []
    existing.push(guard)
    this.guards.set(key, existing)
  }

  /** Runs every guard registered for this `(recordType, fromStateKey)` pair, in registration order, stopping at the first disallow — most transitions have zero registered guards and this resolves instantly. */
  async check(
    recordType: string,
    fromStateKey: string,
    ctx: TransitionGuardContext,
  ): Promise<TransitionGuardResult> {
    const guards = this.guards.get(this.key(recordType, fromStateKey)) ?? []
    for (const guard of guards) {
      const result = await guard(ctx)
      if (!result.allowed) return result
    }
    return { allowed: true }
  }

  private key(recordType: string, fromStateKey: string): string {
    return `${recordType}:${fromStateKey}`
  }
}
