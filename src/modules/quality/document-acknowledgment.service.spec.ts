import { ConflictException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { DocumentAcknowledgmentService } from './document-acknowledgment.service'

const actor: AuthenticatedUser = {
  sub: 'qa-manager-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_MANAGER'],
  platformRole: null,
  tokenVersion: 1,
}
const reader: AuthenticatedUser = {
  sub: 'reader-1',
  companyId: 'company-1',
  roleKeys: ['DISPENSING_PHARMACIST'],
  platformRole: null,
  tokenVersion: 1,
}

interface Row {
  id: string
  [key: string]: unknown
}

function createTable<T extends Row>(defaults: Partial<T> = {}) {
  const rows = new Map<string, T>()
  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) =>
      value === undefined ? true : row[key] === value,
    )
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
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<T> }) => {
      const existing = rows.get(where.id)!
      const updated = { ...existing, ...data }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })
  return { rows, create, findFirst, findMany, update }
}

function buildHarness() {
  const tables = {
    sop: createTable({ status: 'effective', currentVersion: 1, acknowledgmentWindowDays: 5 }),
    documentAcknowledgment: createTable(),
  }
  tables.sop.rows.set('sop-1', {
    id: 'sop-1',
    companyId: 'company-1',
    title: 'Deviation Handling',
    status: 'effective',
    currentVersion: 1,
    acknowledgmentWindowDays: 5,
  })
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new DocumentAcknowledgmentService(rls as never, auditService)
  return { service, tables, auditLog }
}

describe('DocumentAcknowledgmentService', () => {
  describe('assignReaders()', () => {
    it('allows pre-assigning readers while the document is in review (Pass A)', async () => {
      const { service, tables } = buildHarness()
      tables.sop.rows.set('sop-1', { ...tables.sop.rows.get('sop-1')!, status: 'in_review' })
      const created = await service.assignReaders(actor, 'sop-1', { userIds: ['reader-1'] }, {})
      expect(created).toHaveLength(1)
    })

    it('rejects assigning readers to a superseded or retired document', async () => {
      const { service, tables } = buildHarness()
      tables.sop.rows.set('sop-1', { ...tables.sop.rows.get('sop-1')!, status: 'retired' })
      await expect(
        service.assignReaders(actor, 'sop-1', { userIds: ['reader-1'] }, {}),
      ).rejects.toThrow(ConflictException)
    })

    it('creates one acknowledgment row per assigned user, at the current version', async () => {
      const { service, tables } = buildHarness()
      const created = await service.assignReaders(
        actor,
        'sop-1',
        { userIds: ['reader-1', 'reader-2'] },
        {},
      )
      expect(created).toHaveLength(2)
      expect(tables.documentAcknowledgment.rows.size).toBe(2)
      expect(
        [...tables.documentAcknowledgment.rows.values()].every((r) => r.versionAcknowledged === 1),
      ).toBe(true)
    })

    it('is idempotent — assigning the same reader twice does not duplicate the row', async () => {
      const { service, tables } = buildHarness()
      await service.assignReaders(actor, 'sop-1', { userIds: ['reader-1'] }, {})
      await service.assignReaders(actor, 'sop-1', { userIds: ['reader-1'] }, {})
      expect(tables.documentAcknowledgment.rows.size).toBe(1)
    })

    it('404s for a nonexistent document', async () => {
      const { service } = buildHarness()
      await expect(
        service.assignReaders(actor, 'nonexistent', { userIds: ['reader-1'] }, {}),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('acknowledge()', () => {
    it('rejects acknowledging when never assigned', async () => {
      const { service } = buildHarness()
      await expect(service.acknowledge(reader, 'sop-1', {})).rejects.toThrow(NotFoundException)
    })

    it('marks the assignment acknowledged, and is idempotent on a repeat call', async () => {
      const { service } = buildHarness()
      await service.assignReaders(actor, 'sop-1', { userIds: [reader.sub] }, {})
      const first = await service.acknowledge(reader, 'sop-1', {})
      expect(first.acknowledgedAt).toBeInstanceOf(Date)

      const second = await service.acknowledge(reader, 'sop-1', {})
      expect(second.acknowledgedAt).toEqual(first.acknowledgedAt)
    })
  })

  describe('listForDocument() — overdue computation', () => {
    it('flags an unacknowledged assignment as overdue once the window has passed', async () => {
      const { service, tables } = buildHarness()
      tables.sop.rows.set('sop-1', {
        ...tables.sop.rows.get('sop-1')!,
        acknowledgmentWindowDays: 5,
      })
      const longAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
      tables.documentAcknowledgment.rows.set('ack-1', {
        id: 'ack-1',
        companyId: 'company-1',
        sopId: 'sop-1',
        userId: reader.sub,
        versionAcknowledged: 1,
        assignedAt: longAgo,
        acknowledgedAt: null,
      })

      const rows = await service.listForDocument(actor, 'sop-1')
      expect(rows[0].overdue).toBe(true)
    })

    it('does not flag an assignment still within its window', async () => {
      const { service, tables } = buildHarness()
      const recent = new Date()
      tables.documentAcknowledgment.rows.set('ack-1', {
        id: 'ack-1',
        companyId: 'company-1',
        sopId: 'sop-1',
        userId: reader.sub,
        versionAcknowledged: 1,
        assignedAt: recent,
        acknowledgedAt: null,
      })

      const rows = await service.listForDocument(actor, 'sop-1')
      expect(rows[0].overdue).toBe(false)
    })

    it('never flags an already-acknowledged row as overdue', async () => {
      const { service, tables } = buildHarness()
      const longAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
      tables.documentAcknowledgment.rows.set('ack-1', {
        id: 'ack-1',
        companyId: 'company-1',
        sopId: 'sop-1',
        userId: reader.sub,
        versionAcknowledged: 1,
        assignedAt: longAgo,
        acknowledgedAt: longAgo,
      })

      const rows = await service.listForDocument(actor, 'sop-1')
      expect(rows[0].overdue).toBe(false)
    })
  })

  describe('acknowledge() — Pass A effective-only guard', () => {
    it('refuses a read-and-understand acknowledgment while the document is still in review', async () => {
      const { service, tables } = buildHarness()
      tables.sop.rows.set('sop-1', { ...tables.sop.rows.get('sop-1')!, status: 'in_review' })
      await expect(service.acknowledge(reader, 'sop-1', {})).rejects.toThrow(ConflictException)
    })
  })
})
