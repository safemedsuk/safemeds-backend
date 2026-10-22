import { ConflictException, ForbiddenException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { OosService } from './oos.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_ASSOCIATE'],
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
      if ('startsWith' in ops)
        return typeof actual === 'string' && actual.startsWith(ops.startsWith as string)
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
    .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {}))),
    )
  const count = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {})).length),
    )
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<T> }) => {
      const existing = rows.get(where.id)!
      const cleaned = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
      const updated = { ...existing, ...cleaned }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })
  return { rows, create, findFirst, findMany, count, update }
}

function buildHarness() {
  const tables = {
    oos: createTable({ status: 'phase_1_lab_investigation' }),
    batch: createTable(),
    document: createTable(),
  }
  tables.batch.rows.set('batch-1', { id: 'batch-1', qualityStatus: 'quarantine' })
  // Pass A2 — findings text needs at least one finding document; the default test fixture attaches one.
  tables.document.rows.set('doc-finding-1', {
    id: 'doc-finding-1',
    companyId: 'company-1',
    recordType: 'oos_finding',
    recordId: 'any',
  })
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const instantiate = jest.fn().mockResolvedValue(undefined)
  const workflowService = { instantiate } as never
  const createFrom = jest
    .fn()
    .mockImplementation((_tx, _actor, companyId, sourceRecordType, sourceRecordId, input) =>
      Promise.resolve({
        id: 'capa-1',
        companyId,
        sourceRecordType,
        sourceRecordId,
        title: input.title,
      }),
    )
  const capaService = { createFrom, createAllocatedFrom: createFrom } as never

  const service = new OosService(rls as never, auditService, workflowService, capaService, {
    uploadDirect: jest.fn(),
  } as never)
  return { service, tables, auditLog, instantiate, createFrom }
}

const baseCreateInput = {
  batchId: 'batch-1',
  specificationId: 'spec-1',
  parameterId: 'param-1',
  testResult: '98.2% assay (spec 99.0-101.0%)',
} as const

describe('OosService', () => {
  describe('create()', () => {
    it('rejects a platform actor with no company', async () => {
      const { service } = buildHarness()
      await expect(service.create(noCompanyActor, baseCreateInput, {})).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('creates an OOS with a real OOS-YYYY-NNNNN number, starting Phase 1', async () => {
      const { service } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      expect(created.status).toBe('phase_1_lab_investigation')
      expect(created.investigationPhase).toBe('phase_1_lab_investigation')
      expect(created.oosNumber).toMatch(/^OOS-\d{4}-\d{5}$/)
    })

    it('instantiates a real quality_oos workflow', async () => {
      const { service, instantiate } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      expect(instantiate).toHaveBeenCalledWith(actor, 'quality_oos', created.id, null, {})
    })
  })

  describe('recordPhase1()', () => {
    it('refuses findings text when no finding document is attached (Pass A2 item 4b)', async () => {
      const { service, tables } = buildHarness()
      tables.document.rows.clear()
      const created = await service.create(actor, baseCreateInput, {})
      await expect(
        service.recordPhase1(
          actor,
          created.id,
          { assignableCauseFound: true, findings: 'Text without evidence' },
          {},
        ),
      ).rejects.toMatchObject({ response: { code: 'FINDING_DOCUMENT_REQUIRED' } })
    })

    it('records an assignable lab cause', async () => {
      const { service, tables } = buildHarness()
      tables.document.rows.set('doc-finding-1', {
        id: 'doc-finding-1',
        companyId: 'company-1',
        recordType: 'oos_finding',
        recordId: 'any',
      })
      const created = await service.create(actor, baseCreateInput, {})
      tables.document.rows.set('doc-finding-2', {
        id: 'doc-finding-2',
        companyId: 'company-1',
        recordType: 'oos_finding',
        recordId: created.id,
      })
      const updated = await service.recordPhase1(
        actor,
        created.id,
        { assignableCauseFound: true, findings: 'Analyst pipetting error confirmed' },
        {},
      )
      expect(updated.phase1AssignableCauseFound).toBe(true)
      expect(updated.phase1Findings).toBe('Analyst pipetting error confirmed')
    })
  })

  describe('recordRetest()', () => {
    it('always requires a written rationale (DTO-level, not re-checked here) and records the decision', async () => {
      const { service } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      const updated = await service.recordRetest(
        actor,
        created.id,
        { authorized: true, rationale: 'Assignable cause confirmed, retest under new analyst' },
        {},
      )
      expect(updated.retestAuthorized).toBe(true)
      expect(updated.retestRationale).toBe('Assignable cause confirmed, retest under new analyst')
    })
  })

  describe('recordPhase2()', () => {
    it('rejects recording Phase 2 findings before the investigation has entered Phase 2', async () => {
      const { service } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      await expect(
        service.recordPhase2(actor, created.id, { findings: 'x', batchImpact: 'no_impact' }, {}),
      ).rejects.toThrow(ConflictException)
    })

    it('records Phase 2 findings once in Phase 2, and rejects the batch on batch_rejected impact', async () => {
      const { service, tables } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      tables.document.rows.set('doc-finding-p2', {
        id: 'doc-finding-p2',
        companyId: 'company-1',
        recordType: 'oos_finding',
        recordId: created.id,
      })
      tables.oos.rows.set(created.id, {
        ...tables.oos.rows.get(created.id)!,
        investigationPhase: 'phase_2_manufacturing_investigation',
      })
      const updated = await service.recordPhase2(
        actor,
        created.id,
        { findings: 'Manufacturing deviation confirmed', batchImpact: 'batch_rejected' },
        {},
      )
      expect(updated.phase2Findings).toBe('Manufacturing deviation confirmed')
      expect(updated.batchImpact).toBe('batch_rejected')
      expect(tables.batch.rows.get('batch-1')?.qualityStatus).toBe('rejected')
    })

    it('reworks the batch on batch_reworked impact', async () => {
      const { service, tables } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      tables.oos.rows.set(created.id, {
        ...tables.oos.rows.get(created.id)!,
        investigationPhase: 'phase_2_manufacturing_investigation',
      })
      await service.recordPhase2(actor, created.id, { batchImpact: 'batch_reworked' }, {})
      expect(tables.batch.rows.get('batch-1')?.qualityStatus).toBe('reworked')
    })

    it('leaves the batch quality status untouched on no_impact', async () => {
      const { service, tables } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      tables.oos.rows.set(created.id, {
        ...tables.oos.rows.get(created.id)!,
        investigationPhase: 'phase_2_manufacturing_investigation',
      })
      await service.recordPhase2(actor, created.id, { batchImpact: 'no_impact' }, {})
      expect(tables.batch.rows.get('batch-1')?.qualityStatus).toBe('quarantine')
    })
  })

  describe('openCapaForOos()', () => {
    it('opens a CAPA via createFrom() with sourceRecordType "oos"', async () => {
      const { service, createFrom } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      const capa = await service.openCapaForOos(
        actor,
        created.id,
        {
          rootCause: 'Analyst pipetting technique drift',
          rootCauseCategory: 'human_error_training',
          correctiveAction: 'Retrain on pipetting SOP',
          ownerUserId: 'owner-user',
          correctiveActionDueDate: '2026-12-01',
        },
        {},
      )
      expect(capa.sourceRecordType).toBe('oos')
      expect(createFrom).toHaveBeenCalledWith(
        expect.anything(),
        actor,
        'company-1',
        'oos',
        created.id,
        expect.objectContaining({ rootCauseCategory: 'human_error_training' }),
        {},
      )
    })
  })
})
