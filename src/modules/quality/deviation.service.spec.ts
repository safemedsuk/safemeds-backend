import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { DeviationService } from './deviation.service'

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
      if ('startsWith' in ops) {
        return typeof actual === 'string' && actual.startsWith(ops.startsWith as string)
      }
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
  const findUnique = jest
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
  return { rows, create, findFirst, findUnique, findMany, count, update }
}

function buildHarness() {
  const tables = {
    deviation: createTable({ status: 'detected' }),
    investigation: createTable(),
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const instantiate = jest.fn().mockResolvedValue(undefined)
  const workflowService = { instantiate } as never
  const encrypt = jest.fn((s: string) => `enc(${s})`)
  const decrypt = jest.fn((s: string) => s.replace(/^enc\(/, '').replace(/\)$/, ''))
  const textEncryption = { encrypt, decrypt } as never
  const createFrom = jest
    .fn()
    .mockImplementation((_tx, _actor, companyId, sourceRecordType, sourceRecordId, input) =>
      Promise.resolve({
        id: 'capa-1',
        companyId,
        sourceRecordType,
        sourceRecordId,
        title: input.title,
        correctiveAction: input.correctiveAction,
        status: 'open',
      }),
    )
  const capaService = {
    createFrom,
    createAllocatedFrom: createFrom,
    listForSource: jest.fn().mockResolvedValue([]),
  } as never

  const service = new DeviationService(
    rls as never,
    auditService,
    workflowService,
    textEncryption,
    capaService,
    { uploadDirect: jest.fn() } as never,
  )
  return { service, tables, auditLog, instantiate, createFrom }
}

describe('DeviationService', () => {
  describe('create()', () => {
    it('rejects a platform actor with no company', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(
          noCompanyActor,
          { title: 'x', sourceType: 'self_reported', detectedAt: '2026-09-01' },
          {},
        ),
      ).rejects.toThrow(ForbiddenException)
    })

    it('creates a deviation with a real DEV-YYYY-NNNNN number, status detected', async () => {
      const { service } = buildHarness()
      const created = await service.create(
        actor,
        {
          title: 'Temperature excursion',
          sourceType: 'monitoring_alert',
          detectedAt: '2026-09-01',
        },
        {},
      )
      expect(created.status).toBe('detected')
      expect(created.deviationNumber).toMatch(/^DEV-\d{4}-\d{5}$/)
    })

    it('encrypts the description on write and decrypts it back on read', async () => {
      const { service } = buildHarness()
      const created = await service.create(
        actor,
        {
          title: 'x',
          description: 'Sensitive process detail',
          sourceType: 'self_reported',
          detectedAt: '2026-09-01',
        },
        {},
      )
      expect(created.description).toBe('Sensitive process detail')
      // never leaks raw ciphertext under the plaintext key
      expect((created as Record<string, unknown>).descriptionEncrypted).toBeUndefined()
    })

    it('instantiates a real quality_deviation workflow', async () => {
      const { service, instantiate } = buildHarness()
      const created = await service.create(
        actor,
        { title: 'x', sourceType: 'self_reported', detectedAt: '2026-09-01' },
        {},
      )
      expect(instantiate).toHaveBeenCalledWith(actor, 'quality_deviation', created.id, null, {})
    })

    it('increments the sequence number within the same year', async () => {
      const { service } = buildHarness()
      const first = await service.create(
        actor,
        { title: 'a', sourceType: 'self_reported', detectedAt: '2026-09-01' },
        {},
      )
      const second = await service.create(
        actor,
        { title: 'b', sourceType: 'self_reported', detectedAt: '2026-09-02' },
        {},
      )
      expect(first.deviationNumber).not.toBe(second.deviationNumber)
    })
  })

  describe('recordInvestigation()', () => {
    it('creates a new investigation record defaulting investigator to the actor', async () => {
      const { service } = buildHarness()
      const deviation = await service.create(
        actor,
        { title: 'x', sourceType: 'self_reported', detectedAt: '2026-09-01' },
        {},
      )
      const investigation = await service.recordInvestigation(
        actor,
        deviation.id,
        { rootCauseMethod: 'five_why', findings: 'Root cause identified' },
        {},
      )
      expect(investigation.investigatorUserId).toBe(actor.sub)
      expect(investigation.rootCauseMethod).toBe('five_why')
    })

    it('updates the existing investigation on a second call rather than duplicating', async () => {
      const { service, tables } = buildHarness()
      const deviation = await service.create(
        actor,
        { title: 'x', sourceType: 'self_reported', detectedAt: '2026-09-01' },
        {},
      )
      await service.recordInvestigation(actor, deviation.id, { findings: 'first pass' }, {})
      await service.recordInvestigation(actor, deviation.id, { findings: 'second pass' }, {})
      expect(tables.investigation.rows.size).toBe(1)
      const [row] = [...tables.investigation.rows.values()]
      expect(row.findings).toBe('second pass')
    })

    it('404s for a nonexistent deviation', async () => {
      const { service } = buildHarness()
      await expect(
        service.recordInvestigation(actor, 'nonexistent', { findings: 'x' }, {}),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('openCapaForDeviation()', () => {
    it('rejects opening a CAPA before the deviation reaches capa_pending', async () => {
      const { service } = buildHarness()
      const deviation = await service.create(
        actor,
        { title: 'x', sourceType: 'self_reported', detectedAt: '2026-09-01' },
        {},
      )
      await expect(
        service.openCapaForDeviation(
          actor,
          deviation.id,
          {
            rootCause: 'Operator skipped the verification step',
            rootCauseCategory: 'human_error_training',
            correctiveAction: 'Retrain staff',
            ownerUserId: 'owner-user',
            correctiveActionDueDate: '2026-12-01',
          },
          {},
        ),
      ).rejects.toThrow(ConflictException)
    })

    it('opens a CAPA via createFrom() once capa_pending, with sourceRecordType "deviation"', async () => {
      const { service, tables, createFrom } = buildHarness()
      const deviation = await service.create(
        actor,
        { title: 'x', sourceType: 'self_reported', detectedAt: '2026-09-01' },
        {},
      )
      tables.deviation.rows.set(deviation.id, {
        ...tables.deviation.rows.get(deviation.id)!,
        status: 'capa_pending',
      })

      const capa = await service.openCapaForDeviation(
        actor,
        deviation.id,
        {
          rootCause: 'Operator skipped the verification step',
          rootCauseCategory: 'human_error_training',
          correctiveAction: 'Retrain staff',
          ownerUserId: 'owner-user',
          correctiveActionDueDate: '2026-12-01',
        },
        {},
      )
      expect(capa.sourceRecordType).toBe('deviation')
      expect(capa.sourceRecordId).toBe(deviation.id)
      expect(createFrom).toHaveBeenCalledWith(
        tables,
        actor,
        'company-1',
        'deviation',
        deviation.id,
        expect.objectContaining({
          rootCauseCategory: 'human_error_training',
          ownerUserId: 'owner-user',
        }),
        {},
      )
    })
  })
})
