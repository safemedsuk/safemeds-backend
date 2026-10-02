import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CapaService } from './capa.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_MANAGER'],
  platformRole: null,
  tokenVersion: 1,
}
const noCompanyActor: AuthenticatedUser = {
  sub: 'user-2',
  companyId: null,
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

interface Row {
  id: string
  [key: string]: unknown
}

function createTable<T extends Row>(defaults: Partial<T> = {}) {
  const rows = new Map<string, T>()
  function matchesValue(actual: unknown, expected: unknown): boolean {
    if (expected === undefined) return true
    if (expected !== null && typeof expected === 'object' && !(expected instanceof Date)) {
      const ops = expected as Record<string, unknown>
      if ('in' in ops) return (ops.in as unknown[]).includes(actual)
      if ('not' in ops) return actual !== ops.not
      if ('lt' in ops) return (actual as Date | number) < (ops.lt as Date | number)
      if ('gte' in ops) return (actual as Date | number) >= (ops.gte as Date | number)
    }
    return actual === expected
  }
  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => matchesValue(row[key], value))
  }
  const create = jest.fn().mockImplementation(({ data }: { data: T }) => {
    rows.set(data.id, { ...defaults, ...data })
    return Promise.resolve(rows.get(data.id))
  })
  const findFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].find((r) => matches(r, where)) ?? null),
    )
  const findMany = jest
    .fn()
    .mockImplementation(
      ({
        where,
        orderBy,
      }: {
        where?: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'>
      }) => {
        let list = [...rows.values()].filter((r) => matches(r, where ?? {}))
        if (orderBy) {
          const [field] = Object.entries(orderBy)[0]
          list = list.sort(
            (a, b) =>
              new Date(a[field] as string).getTime() - new Date(b[field] as string).getTime(),
          )
        }
        return Promise.resolve(list)
      },
    )
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<T> }) => {
      const existing = rows.get(where.id)!
      // Prisma silently drops `undefined` fields in a partial update rather than nulling them — the mock must too.
      const cleaned = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
      const updated = { ...existing, ...cleaned }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })
  return { rows, create, findFirst, findMany, update }
}

function buildHarness() {
  const tables = {
    capa: createTable({ status: 'open', flaggedRecurring: false }),
    auditFinding: createTable({ status: 'open' }),
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const escalateForRecord = jest.fn().mockResolvedValue(undefined)
  const tasksService = { escalateForRecord } as never

  const service = new CapaService(rls as never, auditService, tasksService)
  return { service, tables, auditLog, escalateForRecord }
}

describe('CapaService', () => {
  describe('create()', () => {
    it('opens a standalone CAPA', async () => {
      const { service } = buildHarness()
      const capa = await service.create(
        actor,
        { title: 'Fix hotline number', correctiveAction: 'Update the number in the CRM' },
        {},
      )
      expect(capa.status).toBe('open')
      expect(capa.findingId).toBeNull()
    })

    it('links to a real finding and flips it to capa_assigned', async () => {
      const { service, tables } = buildHarness()
      tables.auditFinding.rows.set('finding-1', {
        id: 'finding-1',
        companyId: 'company-1',
        status: 'open',
      })

      const capa = await service.create(
        actor,
        { findingId: 'finding-1', title: 'x', correctiveAction: 'y' },
        {},
      )
      expect(capa.findingId).toBe('finding-1')
      expect(tables.auditFinding.rows.get('finding-1')!.status).toBe('capa_assigned')
    })

    it('404s when the finding does not exist', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(actor, { findingId: 'nonexistent', title: 'x', correctiveAction: 'y' }, {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(noCompanyActor, { title: 'x', correctiveAction: 'y' }, {}),
      ).rejects.toThrow(ForbiddenException)
    })

    it('QualCloud Stage 0.3 — findingId alone auto-maps to sourceRecordType "audit_finding"', async () => {
      const { service, tables } = buildHarness()
      tables.auditFinding.rows.set('finding-1', {
        id: 'finding-1',
        companyId: 'company-1',
        status: 'open',
      })
      const capa = await service.create(
        actor,
        { findingId: 'finding-1', title: 'x', correctiveAction: 'y' },
        {},
      )
      expect(capa.sourceRecordType).toBe('audit_finding')
      expect(capa.sourceRecordId).toBe('finding-1')
    })

    it('QualCloud Stage 0.3 — accepts an explicit sourceRecordType/sourceRecordId with no findingId', async () => {
      const { service } = buildHarness()
      const capa = await service.create(
        actor,
        {
          title: 'Contain affected batch',
          correctiveAction: 'Quarantine',
          sourceRecordType: 'deviation',
          sourceRecordId: 'deviation-1',
        },
        {},
      )
      expect(capa.findingId).toBeNull()
      expect(capa.sourceRecordType).toBe('deviation')
      expect(capa.sourceRecordId).toBe('deviation-1')
    })
  })

  describe('createFrom() — the direct, non-HTTP entry point future quality modules call', () => {
    it('creates a CAPA against an arbitrary source record inside an existing transaction', async () => {
      const { service, tables, auditLog } = buildHarness()
      const capa = await service.createFrom(
        tables as never,
        actor,
        'company-1',
        'oos',
        'oos-1',
        { title: 'Investigate OOS', correctiveAction: 'Retest' },
        {},
      )
      expect(capa.sourceRecordType).toBe('oos')
      expect(capa.sourceRecordId).toBe('oos-1')
      expect(capa.findingId).toBeUndefined()
      expect(auditLog).toHaveBeenCalledWith(
        tables,
        expect.objectContaining({ action: 'capa_opened', recordId: capa.id }),
      )
    })
  })

  describe('close() — the effectiveness-check gate', () => {
    it('rejects closing a CAPA with no effectiveness check recorded', async () => {
      const { service } = buildHarness()
      const capa = await service.create(actor, { title: 'x', correctiveAction: 'y' }, {})
      await expect(service.close(actor, capa.id, {})).rejects.toThrow(ConflictException)
    })

    it('allows closing once an effectiveness check is recorded', async () => {
      const { service } = buildHarness()
      const capa = await service.create(actor, { title: 'x', correctiveAction: 'y' }, {})
      await service.recordEffectivenessCheck(actor, capa.id, { result: 'effective' }, {})

      const closed = await service.close(actor, capa.id, {})
      expect(closed.status).toBe('closed')
      expect(closed.closedAt).toBeInstanceOf(Date)
    })

    it('a "not_effective" result still lets the CAPA be closed (a real, honest outcome, not itself a block)', async () => {
      const { service } = buildHarness()
      const capa = await service.create(actor, { title: 'x', correctiveAction: 'y' }, {})
      await service.recordEffectivenessCheck(
        actor,
        capa.id,
        { result: 'not_effective', note: 'Recurred within a month' },
        {},
      )
      const closed = await service.close(actor, capa.id, {})
      expect(closed.status).toBe('closed')
    })

    it('rejects closing an already-closed CAPA', async () => {
      const { service } = buildHarness()
      const capa = await service.create(actor, { title: 'x', correctiveAction: 'y' }, {})
      await service.recordEffectivenessCheck(actor, capa.id, { result: 'effective' }, {})
      await service.close(actor, capa.id, {})
      await expect(service.close(actor, capa.id, {})).rejects.toThrow(ConflictException)
    })

    it('closing a CAPA linked to a finding also closes the finding', async () => {
      const { service, tables } = buildHarness()
      tables.auditFinding.rows.set('finding-1', {
        id: 'finding-1',
        companyId: 'company-1',
        status: 'open',
      })
      const capa = await service.create(
        actor,
        { findingId: 'finding-1', title: 'x', correctiveAction: 'y' },
        {},
      )
      await service.recordEffectivenessCheck(actor, capa.id, { result: 'effective' }, {})
      await service.close(actor, capa.id, {})
      expect(tables.auditFinding.rows.get('finding-1')!.status).toBe('closed')
    })
  })

  describe('update()', () => {
    it('rejects editing an already-closed CAPA', async () => {
      const { service } = buildHarness()
      const capa = await service.create(actor, { title: 'x', correctiveAction: 'y' }, {})
      await service.recordEffectivenessCheck(actor, capa.id, { result: 'effective' }, {})
      await service.close(actor, capa.id, {})
      await expect(
        service.update(actor, capa.id, { title: 'renamed' } as never, {}),
      ).rejects.toThrow(ConflictException)
    })
  })

  describe('assignAction() — QualCloud Stage 3, correction/corrective/preventive as three distinct fields', () => {
    it('sets correction independently of the existing correctiveAction/preventiveAction', async () => {
      const { service } = buildHarness()
      const capa = await service.create(actor, { title: 'x', correctiveAction: 'y' }, {})
      const updated = await service.assignAction(
        actor,
        capa.id,
        { correction: 'Discard affected units' },
        {},
      )
      expect(updated.correction).toBe('Discard affected units')
      expect(updated.correctiveAction).toBe('y')
    })

    it('rejects assigning action on an already-closed CAPA', async () => {
      const { service } = buildHarness()
      const capa = await service.create(actor, { title: 'x', correctiveAction: 'y' }, {})
      await service.recordEffectivenessCheck(actor, capa.id, { result: 'effective' }, {})
      await service.close(actor, capa.id, {})
      await expect(service.assignAction(actor, capa.id, { correction: 'z' }, {})).rejects.toThrow(
        ConflictException,
      )
    })
  })

  describe('approve() / regulatoryApprove() / implement() — QualCloud Stage 3 cross-functional sign-off', () => {
    it('approve() stamps approvedBy/approvedAt and rejects a second approval', async () => {
      const { service } = buildHarness()
      const capa = await service.create(actor, { title: 'x', correctiveAction: 'y' }, {})
      const approved = await service.approve(actor, capa.id, {}, {})
      expect(approved.approvedBy).toBe(actor.sub)
      expect(approved.approvedAt).toBeInstanceOf(Date)
      await expect(service.approve(actor, capa.id, {}, {})).rejects.toThrow(ConflictException)
    })

    it('implement() requires approval first', async () => {
      const { service } = buildHarness()
      const capa = await service.create(actor, { title: 'x', correctiveAction: 'y' }, {})
      await expect(service.implement(actor, capa.id, {})).rejects.toThrow(ConflictException)
      await service.approve(actor, capa.id, {}, {})
      const implemented = await service.implement(actor, capa.id, {})
      expect(implemented.status).toBe('in_progress')
      expect(implemented.implementedAt).toBeInstanceOf(Date)
    })

    it('close() blocks on a required-but-missing regulatory approval, then allows it once granted', async () => {
      const { service } = buildHarness()
      const capa = await service.create(actor, { title: 'x', correctiveAction: 'y' }, {})
      await service.approve(actor, capa.id, { requiresRegulatoryApproval: true }, {})
      await service.recordEffectivenessCheck(actor, capa.id, { result: 'effective' }, {})
      await expect(service.close(actor, capa.id, {})).rejects.toThrow(ConflictException)

      await service.regulatoryApprove(actor, capa.id, {})
      const closed = await service.close(actor, capa.id, {})
      expect(closed.status).toBe('closed')
    })

    it('regulatoryApprove() rejects a CAPA never marked as needing it', async () => {
      const { service } = buildHarness()
      const capa = await service.create(actor, { title: 'x', correctiveAction: 'y' }, {})
      await expect(service.regulatoryApprove(actor, capa.id, {})).rejects.toThrow(ConflictException)
    })
  })

  describe('reopen-on-recurrence — QualCloud Stage 3', () => {
    it('flags a prior effective CAPA when a new one shares its root-cause category within 12 months', async () => {
      const { service } = buildHarness()
      const first = await service.create(
        actor,
        { title: 'First occurrence', correctiveAction: 'Fix', rootCauseCategory: 'operator_error' },
        {},
      )
      await service.recordEffectivenessCheck(actor, first.id, { result: 'effective' }, {})
      await service.close(actor, first.id, {})

      const second = await service.create(
        actor,
        {
          title: 'Second occurrence',
          correctiveAction: 'Fix again',
          rootCauseCategory: 'operator_error',
        },
        {},
      )

      const refreshedFirst = await service.get(actor, first.id)
      expect(refreshedFirst.flaggedRecurring).toBe(true)
      expect(refreshedFirst.recurringFlagReason).toContain(second.id)
    })

    it('does not flag when the root-cause category differs', async () => {
      const { service } = buildHarness()
      const first = await service.create(
        actor,
        { title: 'First', correctiveAction: 'Fix', rootCauseCategory: 'operator_error' },
        {},
      )
      await service.recordEffectivenessCheck(actor, first.id, { result: 'effective' }, {})
      await service.close(actor, first.id, {})

      await service.create(
        actor,
        { title: 'Unrelated', correctiveAction: 'Fix', rootCauseCategory: 'equipment_failure' },
        {},
      )

      const refreshedFirst = await service.get(actor, first.id)
      expect(refreshedFirst.flaggedRecurring).toBe(false)
    })

    it('does not flag a prior CAPA that was closed not_effective', async () => {
      const { service } = buildHarness()
      const first = await service.create(
        actor,
        { title: 'First', correctiveAction: 'Fix', rootCauseCategory: 'operator_error' },
        {},
      )
      await service.recordEffectivenessCheck(actor, first.id, { result: 'not_effective' }, {})
      await service.close(actor, first.id, {})

      await service.create(
        actor,
        { title: 'Second', correctiveAction: 'Fix', rootCauseCategory: 'operator_error' },
        {},
      )

      const refreshedFirst = await service.get(actor, first.id)
      expect(refreshedFirst.flaggedRecurring).toBe(false)
    })
  })

  describe('escalateOverdue() — QualCloud Stage 3 daily scan', () => {
    it('escalates every overdue, non-closed CAPA across companies via TasksService', async () => {
      const { service, tables, escalateForRecord } = buildHarness()
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
      tables.capa.rows.set('overdue-1', {
        id: 'overdue-1',
        companyId: 'company-1',
        status: 'open',
        title: 'Overdue CAPA',
        dueDate: past,
      })
      tables.capa.rows.set('not-due-1', {
        id: 'not-due-1',
        companyId: 'company-1',
        status: 'open',
        title: 'Not due yet',
        dueDate: future,
      })
      tables.capa.rows.set('closed-overdue-1', {
        id: 'closed-overdue-1',
        companyId: 'company-2',
        status: 'closed',
        title: 'Closed but overdue',
        dueDate: past,
      })

      const result = await service.escalateOverdue()
      expect(result.capasEscalated).toBe(1)
      expect(result.companiesScanned).toBe(1)
      expect(escalateForRecord).toHaveBeenCalledWith(
        'company-1',
        'capa',
        'overdue-1',
        'overdue',
        expect.stringContaining('Overdue CAPA'),
        {},
      )
    })
  })
})
