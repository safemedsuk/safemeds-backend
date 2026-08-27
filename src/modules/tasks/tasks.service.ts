import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, Task, TaskStatus } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { ListTasksQueryDto } from './dto/list-tasks-query.dto'

export interface RequestMeta {
  ip?: string
}

export interface CreateTaskInput {
  companyId: string
  recordType: string
  recordId: string
  title: string
  assignedRoleKey?: string
  assignedUserId?: string
  urgency?: string
  actorUserId?: string
}

export interface TaskSummary {
  me: number
  role: number
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Tasks are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * Phase 9 — the human action queue. Tasks are born from workflow events
 * (see `WorkflowService`'s hooks into `createForWorkflowState`/
 * `closeOpenForRecord`) and from deadline escalation (see
 * `WorkflowTaskEscalationNotifier`) — nothing here originates a task on
 * its own, this service only manages the lifecycle of ones handed to it.
 *
 * Every method routes through `RlsService`, and deliberately doesn't care
 * whether it's called standalone (opens its own RLS-scoped transaction)
 * or nested inside a caller that's already inside one (e.g.
 * `WorkflowService.transition()`'s outer `runAsCompany` — see that
 * service's own doc comment on why this matters): `RlsService`'s
 * AsyncLocalStorage-based reuse makes both cases transparent here.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async createForWorkflowState(input: CreateTaskInput, meta: RequestMeta): Promise<Task> {
    if (!input.assignedRoleKey && !input.assignedUserId) {
      throw new Error(
        'createForWorkflowState requires exactly one of assignedRoleKey/assignedUserId',
      )
    }

    return this.rls.runAsCompany(input.companyId, async (tx) => {
      const created = await tx.task.create({
        data: {
          id: newId(),
          companyId: input.companyId,
          recordType: input.recordType,
          recordId: input.recordId,
          title: input.title,
          assignedRoleKey: input.assignedRoleKey,
          assignedUserId: input.assignedUserId,
          urgency: input.urgency ?? 'normal',
        },
      })

      await this.auditService.log(tx, {
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        actorType: input.actorUserId ? 'user' : 'system',
        action: 'task_created',
        recordType: 'task',
        recordId: created.id,
        newValue: {
          title: created.title,
          forRecordType: input.recordType,
          forRecordId: input.recordId,
          assignedRoleKey: input.assignedRoleKey,
          assignedUserId: input.assignedUserId,
        },
        ip: meta.ip,
      })

      return created
    })
  }

  /** Called when a workflow transition completes — whatever the closed state's task represented is now done. */
  async closeOpenForRecord(
    companyId: string,
    recordType: string,
    recordId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.rls.runAsCompany(companyId, async (tx) => {
      const open = await tx.task.findMany({
        where: { companyId, recordType, recordId, status: { in: ['open', 'claimed'] } },
      })
      for (const task of open) {
        await tx.task.update({
          where: { id: task.id },
          data: { status: 'closed', closedAt: new Date() },
        })
        await this.auditService.log(tx, {
          companyId,
          actorType: 'system',
          action: 'task_closed',
          recordType: 'task',
          recordId: task.id,
          ip: meta.ip,
        })
      }
    })
  }

  /**
   * Bumps urgency on whatever's currently open for this record rather than
   * piling up a second task for the same thing — the normal case, since a
   * workflow-state task should already exist for whoever needs to act.
   * Falls back to creating a fresh `SYSTEM_ADMINISTRATOR`-queue task only
   * if genuinely nothing is open (edge case: e.g. all prior tasks already
   * closed by the time escalation fires), so an escalation is never
   * silently dropped.
   */
  async escalateForRecord(
    companyId: string,
    recordType: string,
    recordId: string,
    urgency: 'due_soon' | 'overdue',
    title: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.rls.runAsCompany(companyId, async (tx) => {
      const open = await tx.task.findMany({
        where: { companyId, recordType, recordId, status: { in: ['open', 'claimed'] } },
      })

      if (open.length === 0) {
        const created = await tx.task.create({
          data: {
            id: newId(),
            companyId,
            recordType,
            recordId,
            title,
            assignedRoleKey: 'SYSTEM_ADMINISTRATOR',
            urgency,
          },
        })
        await this.auditService.log(tx, {
          companyId,
          actorType: 'system',
          action: 'task_created',
          recordType: 'task',
          recordId: created.id,
          newValue: {
            title,
            forRecordType: recordType,
            forRecordId: recordId,
            urgency,
            fallback: true,
          },
          ip: meta.ip,
        })
        return
      }

      // Never downgrade — 'overdue' beats 'due_soon' beats 'normal'.
      const rank: Record<string, number> = { normal: 0, due_soon: 1, overdue: 2 }
      for (const task of open) {
        if (rank[urgency] <= rank[task.urgency]) continue
        await tx.task.update({ where: { id: task.id }, data: { urgency } })
        await this.auditService.log(tx, {
          companyId,
          actorType: 'system',
          action: 'task_escalated',
          recordType: 'task',
          recordId: task.id,
          oldValue: { urgency: task.urgency },
          newValue: { urgency },
          ip: meta.ip,
        })
      }
    })
  }

  async list(actor: AuthenticatedUser, query: ListTasksQueryDto): Promise<PaginatedResult<Task>> {
    const companyId = requireCompany(actor)
    const scope = query.scope ?? 'me'

    return this.rls.runAsCompany(companyId, async (tx) => {
      let scopeWhere: Prisma.TaskWhereInput
      if (scope === 'me') {
        scopeWhere = { OR: [{ assignedUserId: actor.sub }, { claimedBy: actor.sub }] }
      } else if (scope === 'role') {
        scopeWhere = { assignedRoleKey: { in: actor.roleKeys }, status: 'open' }
      } else {
        scopeWhere = {}
      }

      const where: Prisma.TaskWhereInput = {
        companyId,
        ...scopeWhere,
        ...(query.recordType ? { recordType: query.recordType } : {}),
        ...(query.recordId ? { recordId: query.recordId } : {}),
        ...(query.urgency ? { urgency: query.urgency } : {}),
        ...(query.status ? { status: query.status as TaskStatus } : {}),
      }

      const [rows, total] = await Promise.all([
        tx.task.findMany({
          where,
          // Overdue-first, then due-soon, then normal; newest first within a tier.
          orderBy: [{ createdAt: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.task.count({ where }),
      ])

      const urgencyRank: Record<string, number> = { overdue: 0, due_soon: 1, normal: 2 }
      rows.sort((a, b) => urgencyRank[a.urgency] - urgencyRank[b.urgency])

      return paginate(rows, total, query)
    })
  }

  async claim(actor: AuthenticatedUser, taskId: string, meta: RequestMeta): Promise<Task> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const task = await tx.task.findFirst({ where: { id: taskId, companyId } })
      if (!task) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Task not found' })
      if (task.status !== 'open') {
        throw new ForbiddenException({
          code: 'TASK_NOT_CLAIMABLE',
          message: 'Only an open task can be claimed',
        })
      }
      if (!task.assignedRoleKey || !actor.roleKeys.includes(task.assignedRoleKey)) {
        throw new ForbiddenException({
          code: 'ROLE_REQUIRED',
          message: `This task requires the ${task.assignedRoleKey} role`,
        })
      }

      const updated = await tx.task.update({
        where: { id: taskId },
        data: { status: 'claimed', claimedBy: actor.sub, claimedAt: new Date() },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'task_claimed',
        recordType: 'task',
        recordId: taskId,
        ip: meta.ip,
      })

      return updated
    })
  }

  /**
   * Special Corner SC-6 — "when/how can a task be reassigned to someone
   * else?" A task's `assignedRoleKey`/`assignedUserId` are fixed at
   * creation time (nothing here models a later hand-to-a-specific-person
   * reassignment), so the real, buildable answer within this app's own
   * queue-based model is: the claimer puts it back into the open role
   * queue, and any other qualified teammate can claim it from there —
   * the same mechanism that put it there in the first place. Only the
   * claimer themselves can release their own claim (no admin-override
   * "steal someone else's claim" path — a stuck/abandoned claim by
   * someone who's OOO is a real ops gap, but out of scope here).
   */
  async release(actor: AuthenticatedUser, taskId: string, meta: RequestMeta): Promise<Task> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const task = await tx.task.findFirst({ where: { id: taskId, companyId } })
      if (!task) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Task not found' })
      if (task.status !== 'claimed' || task.claimedBy !== actor.sub) {
        throw new ForbiddenException({
          code: 'NOT_YOUR_CLAIM',
          message: 'Only the person who claimed this task can release it',
        })
      }

      const updated = await tx.task.update({
        where: { id: taskId },
        data: { status: 'open', claimedBy: null, claimedAt: null },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'task_released',
        recordType: 'task',
        recordId: taskId,
        ip: meta.ip,
      })

      return updated
    })
  }

  async summary(actor: AuthenticatedUser): Promise<TaskSummary> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const [me, role] = await Promise.all([
        tx.task.count({
          where: {
            companyId,
            status: { in: ['open', 'claimed'] },
            OR: [{ assignedUserId: actor.sub }, { claimedBy: actor.sub }],
          },
        }),
        tx.task.count({
          where: { companyId, status: 'open', assignedRoleKey: { in: actor.roleKeys } },
        }),
      ])
      return { me, role }
    })
  }
}
