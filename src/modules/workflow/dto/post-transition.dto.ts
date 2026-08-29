import { IsObject, IsOptional, IsString } from 'class-validator'

export class PostTransitionDto {
  @IsString()
  toStateKey!: string

  /** Required only when the resolved transition has `requiresSignature: true` — validated in the service, not here, since that depends on which transition is being attempted. */
  @IsOptional()
  @IsString()
  signatureToken?: string

  @IsOptional()
  @IsString()
  intentStatement?: string

  /**
   * VigiCloud Stage 17 — a free-text rationale for this specific
   * transition, always optional at this generic layer (most record
   * types, `pv_case` included, don't require one). Whether a rationale
   * is actually mandatory for a given `(recordType, fromStateKey)` pair
   * is a domain decision, enforced by that domain's own
   * `WorkflowGuardRegistryService` guard (see `SignalWorkflowGuards`) —
   * not by this DTO, which stays record-type-agnostic like the rest of
   * the engine.
   */
  @IsOptional()
  @IsString()
  note?: string

  /**
   * RegCloud (Phase 12) Stage 6 — a generic, opt-in bag of caller-supplied
   * structured data for a transition whose domain action needs more than
   * a role/signature/note (e.g. approving a registration needs a real
   * registration number). Threaded into both `TransitionGuardContext`
   * (a guard can validate its shape/presence) and `StatusSyncContext` (a
   * domain module's status-sync function can act on it) — purely
   * additive, mirroring `note`'s own Stage 17 addition exactly: every
   * existing transition that never passes this sees `undefined`, zero
   * behavior change. Left as a loose object at this generic layer on
   * purpose — the engine itself has no business knowing what shape any
   * particular domain's payload takes; validation of its actual content
   * belongs to that domain's own guard.
   */
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>
}
