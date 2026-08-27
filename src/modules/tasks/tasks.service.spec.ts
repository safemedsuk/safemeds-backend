import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { TasksService } from './tasks.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['SUPERINTENDENT_PHARMACIST'],
  platformRole: null,
  tokenVersion: 1,
}

interface TaskRow {
  id: string
  companyId: string
  recordType: string
  recordId: string
  title: string
  status: string
  assignedRoleKey?: string | null
  assignedUserId?: string | null
  claimedBy?: string | null
  urgency: string
}

type CreateTaskData = Omit<TaskRow, 'status' | 'urgency'> & { status?: string; urgency?: string }

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const tasks = new Map<string, TaskRow>()

  const create = jest.fn().mockImplementation(({ data }: { data: CreateTaskData }) => {
    tasks.set(data.id, { status: 'open', urgency: 'normal', ...data })
    return Promise.resolve(tasks.get(data.id))
  })
  const findMany = jest
    .fn()
    .mockImplementation(
      ({
        where,
      }: {
        where: {
          companyId: string
          recordType?: string
          recordId?: string
          status?: unknown
          assignedRoleKey?: unknown
          OR?: unknown[]
        }
      }) => {
        let rows = [...tasks.values()].filter((t) => t.companyId === where.companyId)
        if (where.recordType) rows = rows.filter((t) => t.recordType === where.recordType)
        if (where.recordId) rows = rows.filter((t) => t.recordId === where.recordId)
        if (where.status && typeof where.status === 'object' && 'in' in where.status) {
          rows = rows.filter((t) => (where.status as { in: string[] }).in.includes(t.status))
        } else if (where.status) {
          rows = rows.filter((t) => t.status === where.status)
        }
        return Promise.resolve(rows)
      },
    )
  const findFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: { id: string; companyId: string } }) => {
      const t = tasks.get(where.id)
      return Promise.resolve(t && t.companyId === where.companyId ? t : null)
    })
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<TaskRow> }) => {
      const existing = tasks.get(where.id)!
      const updated = { ...existing, ...data }
      tasks.set(where.id, updated)
      return Promise.resolve(updated)
    })
  const count = jest
    .fn()
    .mockImplementation(
      ({
        where,
      }: {
        where: {
          companyId: string
          recordType?: string
          recordId?: string
          status?: unknown
          assignedRoleKey?: unknown
          assignedUserId?: unknown
          OR?: { assignedUserId?: string; claimedBy?: string }[]
        }
      }) => {
        let rows = [...tasks.values()].filter((t) => t.companyId === where.companyId)
        if (where.recordType) rows = rows.filter((t) => t.recordType === where.recordType)
        if (where.recordId) rows = rows.filter((t) => t.recordId === where.recordId)
        if (where.status && typeof where.status === 'object' && 'in' in where.status) {
          rows = rows.filter((t) => (where.status as { in: string[] }).in.includes(t.status))
        } else if (where.status) {
          rows = rows.filter((t) => t.status === where.status)
        }
        if (where.OR)
          rows = rows.filter((t) =>
            where.OR!.some(
              (c) =>
                (c.assignedUserId && t.assignedUserId === c.assignedUserId) ||
                (c.claimedBy && t.claimedBy === c.claimedBy),
            ),
          )
        if (where.assignedRoleKey && typeof where.assignedRoleKey === 'object')
          rows = rows.filter((t) =>
            (where.assignedRoleKey as { in: string[] }).in.includes(t.assignedRoleKey ?? ''),
          )
        return Promise.resolve(rows.length)
      },
    )

  const tables = { task: { create, findMany, findFirst, update, count } }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new TasksService(rls as never, auditService)
  return { service, tasks, auditLog }
}

describe('TasksService', () => {
  it('createForWorkflowState() requires exactly one of assignedRoleKey/assignedUserId', async () => {
    const { service } = buildHarness()
    await expect(
      service.createForWorkflowState(
        { companyId: 'company-1', recordType: 'pv_case', recordId: 'r1', title: 'Triage' },
        {},
      ),
    ).rejects.toThrow()
  })

  it('creates an open role-queue task and audits it', async () => {
    const { service, auditLog } = buildHarness()
    const task = await service.createForWorkflowState(
      {
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'r1',
        title: 'Triage — pv_case',
        assignedRoleKey: 'SUPERINTENDENT_PHARMACIST',
        actorUserId: 'creator-1',
      },
      {},
    )
    expect(task.status).toBe('open')
    expect(task.assignedRoleKey).toBe('SUPERINTENDENT_PHARMACIST')
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'task_created' }),
    )
  })

  it('closeOpenForRecord() closes every open/claimed task for that record, leaves others alone', async () => {
    const { service, tasks } = buildHarness()
    await service.createForWorkflowState(
      {
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'r1',
        title: 'A',
        assignedRoleKey: 'QPPV',
      },
      {},
    )
    tasks.set('other-record-task', {
      id: 'other-record-task',
      companyId: 'company-1',
      recordType: 'pv_case',
      recordId: 'r2',
      title: 'B',
      status: 'open',
      urgency: 'normal',
      assignedRoleKey: 'QPPV',
    })

    await service.closeOpenForRecord('company-1', 'pv_case', 'r1', {})

    const forR1 = [...tasks.values()].filter((t) => t.recordId === 'r1')
    expect(forR1.every((t) => t.status === 'closed')).toBe(true)
    expect(tasks.get('other-record-task')!.status).toBe('open')
  })

  it('escalateForRecord() bumps urgency on an existing open task rather than creating a duplicate', async () => {
    const { service, tasks } = buildHarness()
    const created = await service.createForWorkflowState(
      {
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'r1',
        title: 'A',
        assignedRoleKey: 'QPPV',
      },
      {},
    )

    await service.escalateForRecord(
      'company-1',
      'pv_case',
      'r1',
      'due_soon',
      'Deadline approaching',
      {},
    )

    expect(tasks.size).toBe(1)
    expect(tasks.get(created.id)!.urgency).toBe('due_soon')
  })

  it('escalateForRecord() never downgrades urgency (overdue stays overdue even if bumped with due_soon again)', async () => {
    const { service, tasks } = buildHarness()
    const created = await service.createForWorkflowState(
      {
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'r1',
        title: 'A',
        assignedRoleKey: 'QPPV',
      },
      {},
    )
    await service.escalateForRecord('company-1', 'pv_case', 'r1', 'overdue', 'Breached', {})

    await service.escalateForRecord(
      'company-1',
      'pv_case',
      'r1',
      'due_soon',
      'Approaching again',
      {},
    )

    expect(tasks.get(created.id)!.urgency).toBe('overdue')
  })

  it('escalateForRecord() creates a fallback SYSTEM_ADMINISTRATOR task when nothing is open', async () => {
    const { service, tasks } = buildHarness()
    await service.escalateForRecord(
      'company-1',
      'pv_case',
      'r-orphan',
      'overdue',
      'Breached with no open task',
      {},
    )

    const created = [...tasks.values()].find((t) => t.recordId === 'r-orphan')
    expect(created?.assignedRoleKey).toBe('SYSTEM_ADMINISTRATOR')
    expect(created?.urgency).toBe('overdue')
  })

  it('claim() requires the task to be open and the actor to hold the required role', async () => {
    const { service } = buildHarness()
    const task = await service.createForWorkflowState(
      {
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'r1',
        title: 'A',
        assignedRoleKey: 'QPPV',
      },
      {},
    )

    await expect(service.claim(actor, task.id, {})).rejects.toThrow(ForbiddenException)
  })

  it('claim() succeeds and sets claimedBy/status when the actor holds the role', async () => {
    const { service } = buildHarness()
    const task = await service.createForWorkflowState(
      {
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'r1',
        title: 'A',
        assignedRoleKey: 'SUPERINTENDENT_PHARMACIST',
      },
      {},
    )

    const claimed = await service.claim(actor, task.id, {})
    expect(claimed.status).toBe('claimed')
    expect(claimed.claimedBy).toBe(actor.sub)
  })

  it('claim() 404s on an unknown task', async () => {
    const { service } = buildHarness()
    await expect(service.claim(actor, 'missing', {})).rejects.toThrow(NotFoundException)
  })

  it('release() puts a claimed task back to open and clears claimedBy, and audits it', async () => {
    const { service, auditLog } = buildHarness()
    const task = await service.createForWorkflowState(
      {
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'r1',
        title: 'A',
        assignedRoleKey: 'SUPERINTENDENT_PHARMACIST',
      },
      {},
    )
    await service.claim(actor, task.id, {})

    const released = await service.release(actor, task.id, {})
    expect(released.status).toBe('open')
    expect(released.claimedBy).toBeNull()
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'task_released' }),
    )
  })

  it('release() rejects a task that is not currently claimed by the actor', async () => {
    const { service } = buildHarness()
    const task = await service.createForWorkflowState(
      {
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'r1',
        title: 'A',
        assignedRoleKey: 'SUPERINTENDENT_PHARMACIST',
      },
      {},
    )

    await expect(service.release(actor, task.id, {})).rejects.toThrow(ForbiddenException)
  })

  it("release() rejects a different user releasing someone else's claim", async () => {
    const { service } = buildHarness()
    const task = await service.createForWorkflowState(
      {
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'r1',
        title: 'A',
        assignedRoleKey: 'SUPERINTENDENT_PHARMACIST',
      },
      {},
    )
    await service.claim(actor, task.id, {})

    const otherActor: AuthenticatedUser = { ...actor, sub: 'user-2' }
    await expect(service.release(otherActor, task.id, {})).rejects.toThrow(ForbiddenException)
  })

  it('release() 404s on an unknown task', async () => {
    const { service } = buildHarness()
    await expect(service.release(actor, 'missing', {})).rejects.toThrow(NotFoundException)
  })

  it('list() filters by recordId, powering a "tasks for this record" view', async () => {
    const { service } = buildHarness()
    await service.createForWorkflowState(
      {
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'r1',
        title: 'A',
        assignedRoleKey: 'SUPERINTENDENT_PHARMACIST',
      },
      {},
    )
    await service.createForWorkflowState(
      {
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'r2',
        title: 'B',
        assignedRoleKey: 'SUPERINTENDENT_PHARMACIST',
      },
      {},
    )

    const page = await service.list(actor, {
      scope: 'all',
      recordId: 'r1',
      page: 1,
      limit: 25,
    } as never)
    expect(page.data).toHaveLength(1)
    expect(page.data[0].recordId).toBe('r1')
  })
})
