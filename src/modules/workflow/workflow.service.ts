import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  Prisma,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowState,
  WorkflowTransition,
} from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { SignatureService } from '../signatures/signature.service'
import { TasksService } from '../tasks/tasks.service'
import { WorkflowGuardRegistryService } from './workflow-guard-registry.service'
import { WorkflowStatusSyncRegistryService } from './workflow-status-sync-registry.service'

export interface RequestMeta {
  ip?: string
}

export type WorkflowDefinitionWithGraph = WorkflowDefinition & {
  states: WorkflowState[]
  transitions: WorkflowTransition[]
}

export interface AvailableTransition {
  id: string
  toStateKey: string
  toStateName: string
  requiredRoleKey: string
  requiresSignature: boolean
  /** Whether the current actor's roleKeys satisfy this transition's required role — the FE uses this to enable/disable action buttons. */
  allowed: boolean
}

interface LockedInstanceRow {
  id: string
  definition_id: string
  current_state_id: string
  record_type: string
  record_id: string
  version: number
}

/**
 * Phase 5.2 — the enforcement core. `transition()` is the one place in the
 * codebase that changes a `WorkflowInstance`'s state, and it does so inside
 * a single transaction: row-lock the instance, verify a transition row
 * exists from its current state, verify the actor holds the required role,
 * consume a signature if the transition demands one, update state, audit —
 * all-or-nothing, so a case can never end up "half transitioned" (signed
 * but not moved, or moved but unaudited).
 */
@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly signatureService: SignatureService,
    private readonly tasksService: TasksService,
    private readonly guardRegistry: WorkflowGuardRegistryService,
    private readonly statusSyncRegistry: WorkflowStatusSyncRegistryService,
  ) {}

  /**
   * Called after entering a state (instantiate, or a completed
   * transition) — finds the *outgoing* transition from that state (the
   * one that determines who needs to act next) and opens a task for its
   * required role. No outgoing transition means the state is terminal
   * (e.g. `submitted`) — nothing to do, the case is finished. Uses
   * `findFirst` rather than `findMany`: every seeded workflow today is a
   * strictly linear chain (one outgoing transition per state), so "the"
   * transition is unambiguous; a future branching workflow would need
   * this revisited to open one task per branch, not silently pick one.
   */
  private async openTaskForState(
    tx: Prisma.TransactionClient,
    companyId: string,
    definitionId: string,
    stateId: string,
    stateName: string,
    recordType: string,
    recordId: string,
    actorUserId: string | undefined,
    meta: RequestMeta,
  ): Promise<void> {
    const outgoing = await tx.workflowTransition.findFirst({
      where: { definitionId, fromStateId: stateId },
      include: { requiredRole: true },
    })
    if (!outgoing) return

    await this.tasksService.createForWorkflowState(
      {
        companyId,
        recordType,
        recordId,
        title: `${stateName} — ${recordType}`,
        assignedRoleKey: outgoing.requiredRole.key,
        actorUserId,
      },
      meta,
    )
  }

  /** Resolves the active definition for a record type — country-specific first, falling back to the global default (`countryId: null`), per the build spec's "country-specific else default" instantiation rule. */
  async resolveActiveDefinition(
    recordType: string,
    countryId?: string | null,
  ): Promise<WorkflowDefinitionWithGraph> {
    if (countryId) {
      const specific = await this.prisma.workflowDefinition.findFirst({
        where: { recordType, countryId, status: 'active' },
        include: { states: true, transitions: true },
      })
      if (specific) return specific
    }

    const fallback = await this.prisma.workflowDefinition.findFirst({
      where: { recordType, countryId: null, status: 'active' },
      include: { states: true, transitions: true },
    })
    if (!fallback) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `No active workflow definition for record type "${recordType}"`,
      })
    }
    return fallback
  }

  async getDefinition(id: string): Promise<WorkflowDefinitionWithGraph> {
    const definition = await this.prisma.workflowDefinition.findUnique({
      where: { id },
      // `id` (UUIDv7, time-ordered) ascending gives creation order, which
      // for the seeded linear lifecycles matches lifecycle order — the FE
      // stepper renders `states` in the order returned rather than trying
      // to derive a sequence from the transition graph itself.
      include: { states: { orderBy: { id: 'asc' } }, transitions: true },
    })
    if (!definition) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Workflow definition not found' })
    }
    return definition
  }

  async getInstance(
    id: string,
  ): Promise<
    WorkflowInstance & { definition: WorkflowDefinitionWithGraph; currentState: WorkflowState }
  > {
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id },
      // The FE's record-detail stepper needs the full state/transition
      // graph to render, not just the definition's own scalar fields — a
      // bare `definition: true` here left `definition.states` undefined
      // client-side (caught via a real browser walk, not just typechecking:
      // Prisma's generated types don't complain about an under-fetched
      // relation the caller happens not to use elsewhere).
      include: {
        definition: { include: { states: { orderBy: { id: 'asc' } }, transitions: true } },
        currentState: true,
      },
    })
    if (!instance) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Workflow instance not found' })
    }
    return instance
  }

  /**
   * `actor.sub` is optional here (unlike everywhere else this codebase
   * requires a full `AuthenticatedUser`) — VigiCloud Stage 3's
   * `PvCaseService.createFromSystemChannel()` instantiates a workflow for
   * a case that genuinely has no logged-in human actor (public-URL/email/
   * WhatsApp intake). Every real caller already passes a full
   * `AuthenticatedUser`, which satisfies this narrower shape structurally
   * — no existing call site needs to change.
   */
  async instantiate(
    actor: Pick<AuthenticatedUser, 'companyId'> & { sub?: string },
    recordType: string,
    recordId: string,
    countryId: string | null,
    meta: RequestMeta,
  ): Promise<WorkflowInstance> {
    if (!actor.companyId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Instantiating a workflow requires a tenant-scoped actor',
      })
    }

    const definition = await this.resolveActiveDefinition(recordType, countryId)
    const initialState = definition.states.find((s) => s.isInitial)
    if (!initialState) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'This workflow definition has no initial state — data integrity issue',
      })
    }

    return this.rls.runAsCompany(actor.companyId, async (tx) => {
      const instance = await tx.workflowInstance.create({
        data: {
          id: newId(),
          definitionId: definition.id,
          recordType,
          recordId,
          currentStateId: initialState.id,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        actorType: actor.sub ? 'user' : 'system',
        companyId: actor.companyId,
        action: 'workflow_instantiated',
        recordType,
        recordId,
        newValue: {
          instanceId: instance.id,
          definitionId: definition.id,
          stateKey: initialState.stateKey,
        },
        ip: meta.ip,
      })

      await this.openTaskForState(
        tx,
        actor.companyId!,
        definition.id,
        initialState.id,
        initialState.name,
        recordType,
        recordId,
        actor.sub,
        meta,
      )

      return instance
    })
  }

  async availableTransitions(
    instanceId: string,
    actor: AuthenticatedUser,
  ): Promise<AvailableTransition[]> {
    const instance = await this.getInstance(instanceId)

    const transitions = await this.prisma.workflowTransition.findMany({
      where: { definitionId: instance.definitionId, fromStateId: instance.currentStateId },
      include: { toState: true, requiredRole: true },
    })

    return transitions.map((t) => ({
      id: t.id,
      toStateKey: t.toState.stateKey,
      toStateName: t.toState.name,
      requiredRoleKey: t.requiredRole.key,
      requiresSignature: t.requiresSignature,
      allowed: actor.roleKeys.includes(t.requiredRole.key),
    }))
  }

  async transition(
    actor: AuthenticatedUser,
    instanceId: string,
    toStateKey: string,
    opts: {
      signatureToken?: string
      intentStatement?: string
      note?: string
      payload?: Record<string, unknown>
    },
    meta: RequestMeta,
  ): Promise<WorkflowInstance> {
    if (!actor.companyId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Transitioning a workflow requires a tenant-scoped actor',
      })
    }

    return this.rls.runAsCompany(actor.companyId, async (tx) => {
      const rows = await tx.$queryRaw<LockedInstanceRow[]>`
        SELECT id, definition_id, current_state_id, record_type, record_id, version
        FROM workflow_instance
        WHERE id = ${instanceId}::uuid
        FOR UPDATE
      `
      const instance = rows[0]
      if (!instance) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Workflow instance not found' })
      }

      const toState = await tx.workflowState.findFirst({
        where: { definitionId: instance.definition_id, stateKey: toStateKey },
      })
      if (!toState) {
        throw new ConflictException({
          code: 'TRANSITION_NOT_ALLOWED',
          message: `"${toStateKey}" is not a state in this workflow`,
        })
      }

      const transitionRow = await tx.workflowTransition.findFirst({
        where: {
          definitionId: instance.definition_id,
          fromStateId: instance.current_state_id,
          toStateId: toState.id,
        },
        include: { requiredRole: true, fromState: true },
      })
      if (!transitionRow) {
        throw new ConflictException({
          code: 'TRANSITION_NOT_ALLOWED',
          message: `No transition from the current state to "${toStateKey}"`,
        })
      }

      if (!actor.roleKeys.includes(transitionRow.requiredRole.key)) {
        throw new ForbiddenException({
          code: 'ROLE_REQUIRED',
          message: `This transition requires the ${transitionRow.requiredRole.key} role`,
          details: { requiredRole: transitionRow.requiredRole.key },
        })
      }

      const guardResult = await this.guardRegistry.check(
        instance.record_type,
        transitionRow.fromState.stateKey,
        {
          tx,
          companyId: actor.companyId!,
          recordId: instance.record_id,
          toStateKey: toState.stateKey,
          actorUserId: actor.sub,
          note: opts.note,
          payload: opts.payload,
        },
      )
      if (!guardResult.allowed) {
        throw new ConflictException({
          code: 'TRANSITION_NOT_ALLOWED',
          message: guardResult.reason ?? 'This transition is not currently allowed',
        })
      }

      let signatureEventId: string | undefined
      if (transitionRow.requiresSignature) {
        if (!opts.signatureToken || !opts.intentStatement) {
          throw new ForbiddenException({
            code: 'SIGNATURE_REQUIRED',
            message: 'This transition requires re-authentication and a signed intent statement',
          })
        }

        const signedAt = new Date()
        const signature = await this.signatureService.sign(
          tx,
          actor,
          {
            recordType: instance.record_type,
            recordId: instance.record_id,
            intentStatement: opts.intentStatement,
            signatureToken: opts.signatureToken,
            roleAtSigning: transitionRow.requiredRole.key,
            canonicalPayload: {
              instanceId: instance.id,
              definitionId: instance.definition_id,
              fromStateKey: transitionRow.fromState.stateKey,
              toStateKey: toState.stateKey,
              actorId: actor.sub,
              timestamp: signedAt.toISOString(),
            },
          },
          meta,
        )
        signatureEventId = signature.id
      }

      const updated = await tx.workflowInstance.update({
        where: { id: instanceId },
        data: { currentStateId: toState.id, enteredAt: new Date(), version: { increment: 1 } },
      })

      // Keep the domain record's own denormalized `status` column (kept
      // for list/export query performance) in sync with the real
      // workflow state, in the same transaction as the transition
      // itself — see `WorkflowStatusSyncRegistryService`'s own doc
      // comment for the real, previously-shipped bug this closes.
      await this.statusSyncRegistry.sync(instance.record_type, {
        tx,
        recordId: instance.record_id,
        toStateKey: toState.stateKey,
        companyId: actor.companyId!,
        actorUserId: actor.sub,
        payload: opts.payload,
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId: actor.companyId,
        action: 'state_change',
        recordType: instance.record_type,
        recordId: instance.record_id,
        oldValue: { stateKey: transitionRow.fromState.stateKey },
        newValue: {
          stateKey: toState.stateKey,
          ...(signatureEventId ? { signatureEventId } : {}),
          ...(opts.note ? { note: opts.note } : {}),
        },
        ip: meta.ip,
      })

      // Whatever task represented "act on the state we just left" is done;
      // open the next one for whoever needs to act on the new state (or
      // nothing, if `toState` is terminal — see `openTaskForState`'s doc).
      await this.tasksService.closeOpenForRecord(
        actor.companyId!,
        instance.record_type,
        instance.record_id,
        meta,
      )
      await this.openTaskForState(
        tx,
        actor.companyId!,
        instance.definition_id,
        toState.id,
        toState.name,
        instance.record_type,
        instance.record_id,
        actor.sub,
        meta,
      )

      return updated
    })
  }
}
