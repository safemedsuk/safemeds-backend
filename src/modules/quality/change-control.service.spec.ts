import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ChangeControlService } from './change-control.service'

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
      if ('startsWith' in ops) return typeof actual === 'string' && actual.startsWith(ops.startsWith as string)
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
  const tables = { changeControl: createTable({ status: 'proposed' }) }
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
  const variationCreate = jest
    .fn()
    .mockResolvedValue({ id: 'variation-1', displayCode: 'VAR-00001-REG-1' })
  const regVariationService = { create: variationCreate } as never

  const service = new ChangeControlService(
    rls as never,
    auditService,
    workflowService,
    textEncryption,
    regVariationService,
  )
  return { service, tables, auditLog, instantiate, variationCreate }
}

const baseCreateInput = {
  title: 'New excipient supplier',
  changeType: 'minor',
  scope: 'supplier',
} as const

describe('ChangeControlService', () => {
  describe('create()', () => {
    it('rejects a platform actor with no company', async () => {
      const { service } = buildHarness()
      await expect(service.create(noCompanyActor, baseCreateInput, {})).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('creates a change control with a real CC-YYYY-NNNNN number, status proposed', async () => {
      const { service } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      expect(created.status).toBe('proposed')
      expect(created.changeNumber).toMatch(/^CC-\d{4}-\d{5}$/)
    })

    it('encrypts the change description on write and decrypts it back on read', async () => {
      const { service } = buildHarness()
      const created = await service.create(
        actor,
        { ...baseCreateInput, changeDescription: 'Sensitive formulation detail' },
        {},
      )
      expect(created.changeDescription).toBe('Sensitive formulation detail')
    })

    it('instantiates a real quality_change_control workflow', async () => {
      const { service, instantiate } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      expect(instantiate).toHaveBeenCalledWith(actor, 'quality_change_control', created.id, null, {})
    })
  })

  describe('assessImpact()', () => {
    const impact = {
      regulatoryImpact: { impacted: true, note: 'affects registration' },
      validationImpact: { impacted: false },
      productSafetyImpact: { impacted: false },
      stabilityImpact: { impacted: false },
      otherSpecificationsImpact: { impacted: false },
    }

    it('records the structured impact assessment', async () => {
      const { service } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      const updated = await service.assessImpact(actor, created.id, impact, {})
      expect(updated.impactAssessment).toEqual(impact)
    })

    it('blocks re-assessing impact once approved', async () => {
      const { service, tables } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      tables.changeControl.rows.set(created.id, {
        ...tables.changeControl.rows.get(created.id)!,
        status: 'approved',
      })
      await expect(service.assessImpact(actor, created.id, impact, {})).rejects.toThrow(
        ConflictException,
      )
    })
  })

  describe('recordApproval()', () => {
    const manager: AuthenticatedUser = { ...actor, sub: 'user-mgr', roleKeys: ['QUALITY_MANAGER'] }
    const regAffairs: AuthenticatedUser = {
      ...actor,
      sub: 'user-reg',
      roleKeys: ['REGULATORY_AFFAIRS_OFFICER'],
    }

    it('rejects an actor whose role is not a required approver', async () => {
      const { service } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      await expect(service.recordApproval(actor, created.id, {}, {})).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('records a QUALITY_MANAGER approval', async () => {
      const { service } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      const updated = await service.recordApproval(manager, created.id, { note: 'looks fine' }, {})
      expect(updated.crossFunctionalApprovals).toEqual([
        expect.objectContaining({ role: 'QUALITY_MANAGER', userId: 'user-mgr' }),
      ])
    })

    it('only accepts a REGULATORY_AFFAIRS_OFFICER approval once regulatory impact is flagged', async () => {
      const { service } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      await expect(service.recordApproval(regAffairs, created.id, {}, {})).rejects.toThrow(
        ForbiddenException,
      )
      await service.assessImpact(
        actor,
        created.id,
        {
          regulatoryImpact: { impacted: true },
          validationImpact: { impacted: false },
          productSafetyImpact: { impacted: false },
          stabilityImpact: { impacted: false },
          otherSpecificationsImpact: { impacted: false },
        },
        {},
      )
      const updated = await service.recordApproval(regAffairs, created.id, {}, {})
      expect(updated.crossFunctionalApprovals).toEqual(
        expect.arrayContaining([expect.objectContaining({ role: 'REGULATORY_AFFAIRS_OFFICER' })]),
      )
    })

    it('replaces, not duplicates, a second approval from the same role', async () => {
      const { service } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      await service.recordApproval(manager, created.id, { note: 'first' }, {})
      const second = await service.recordApproval(manager, created.id, { note: 'second' }, {})
      expect(second.crossFunctionalApprovals).toHaveLength(1)
      expect((second.crossFunctionalApprovals as { note?: string }[])[0].note).toBe('second')
    })
  })

  describe('openLinkedVariation()', () => {
    it('rejects when no regulatory impact was flagged', async () => {
      const { service } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      await expect(service.openLinkedVariation(actor, created.id, {}, {})).rejects.toThrow(
        ConflictException,
      )
    })

    it('rejects when the affected registration is unknown', async () => {
      const { service } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      await service.assessImpact(
        actor,
        created.id,
        {
          regulatoryImpact: { impacted: true },
          validationImpact: { impacted: false },
          productSafetyImpact: { impacted: false },
          stabilityImpact: { impacted: false },
          otherSpecificationsImpact: { impacted: false },
        },
        {},
      )
      await expect(service.openLinkedVariation(actor, created.id, {}, {})).rejects.toThrow(
        BadRequestException,
      )
    })

    it('opens a real RegVariation via RegVariationService.create() and links it back', async () => {
      const { service, variationCreate } = buildHarness()
      const created = await service.create(
        actor,
        { ...baseCreateInput, affectedProductRegistrationId: 'reg-1' },
        {},
      )
      await service.assessImpact(
        actor,
        created.id,
        {
          regulatoryImpact: { impacted: true },
          validationImpact: { impacted: false },
          productSafetyImpact: { impacted: false },
          stabilityImpact: { impacted: false },
          otherSpecificationsImpact: { impacted: false },
        },
        {},
      )
      const updated = await service.openLinkedVariation(actor, created.id, {}, {})
      expect(variationCreate).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({ productRegistrationId: 'reg-1', variationType: 'minor' }),
        {},
      )
      expect(updated.linkedRegVariationId).toBe('variation-1')
    })

    it('rejects opening a second linked variation', async () => {
      const { service } = buildHarness()
      const created = await service.create(
        actor,
        { ...baseCreateInput, affectedProductRegistrationId: 'reg-1' },
        {},
      )
      await service.assessImpact(
        actor,
        created.id,
        {
          regulatoryImpact: { impacted: true },
          validationImpact: { impacted: false },
          productSafetyImpact: { impacted: false },
          stabilityImpact: { impacted: false },
          otherSpecificationsImpact: { impacted: false },
        },
        {},
      )
      await service.openLinkedVariation(actor, created.id, {}, {})
      await expect(service.openLinkedVariation(actor, created.id, {}, {})).rejects.toThrow(
        ConflictException,
      )
    })
  })

  describe('recordImplementation()', () => {
    it('404s for a nonexistent change control', async () => {
      const { service } = buildHarness()
      await expect(
        service.recordImplementation(actor, 'nonexistent', { verificationResult: 'ok' }, {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('records implementation and verification results', async () => {
      const { service } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      const updated = await service.recordImplementation(
        actor,
        created.id,
        { implementationRecord: 'Rolled out', verificationResult: 'No adverse effect observed' },
        {},
      )
      expect(updated.implementationRecord).toBe('Rolled out')
      expect(updated.verificationResult).toBe('No adverse effect observed')
    })
  })
})
