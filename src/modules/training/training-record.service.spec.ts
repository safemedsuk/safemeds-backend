import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { computeTrainingStatus, TrainingRecordService } from './training-record.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
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

function createTable<T extends Row>() {
  const rows = new Map<string, T>()
  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) =>
      value === undefined ? true : row[key] === value,
    )
  }
  const create = jest.fn().mockImplementation(({ data }: { data: T }) => {
    rows.set(data.id, data)
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
          const [field, dir] = Object.entries(orderBy)[0]
          list = list.sort(
            (a, b) =>
              (new Date(a[field] as string).getTime() - new Date(b[field] as string).getTime()) *
              (dir === 'desc' ? -1 : 1),
          )
        }
        return Promise.resolve(list)
      },
    )
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<T> }) => {
      const existing = rows.get(where.id)!
      const updated = { ...existing, ...data }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })
  const count = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> } = {}) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {})).length),
    )
  return { rows, create, findFirst, findMany, update, count }
}

function buildHarness() {
  const tables = { trainingRecord: createTable(), user: createTable(), document: createTable() }
  tables.user.rows.set('staff-1', { id: 'staff-1', companyId: 'company-1' })

  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new TrainingRecordService(rls as never, auditService)
  return { service, tables, auditLog }
}

describe('computeTrainingStatus()', () => {
  it('is valid when there is no expiry date at all', () => {
    expect(computeTrainingStatus(null)).toBe('valid')
  })

  it('is valid when far from expiry', () => {
    const far = new Date()
    far.setDate(far.getDate() + 90)
    expect(computeTrainingStatus(far)).toBe('valid')
  })

  it('is expiring within the 30-day window', () => {
    const soon = new Date()
    soon.setDate(soon.getDate() + 10)
    expect(computeTrainingStatus(soon)).toBe('expiring')
  })

  it('is expired once past the date', () => {
    const past = new Date()
    past.setDate(past.getDate() - 1)
    expect(computeTrainingStatus(past)).toBe('expired')
  })
})

describe('TrainingRecordService', () => {
  describe('create()', () => {
    it('logs a training record for a real company member', async () => {
      const { service } = buildHarness()
      const record = await service.create(
        actor,
        {
          userId: 'staff-1',
          trainingType: 'gvp_certificate',
          title: 'GVP Refresher 2026',
          completionDate: '2026-01-01',
        },
        {},
      )
      expect(record.trainingType).toBe('gvp_certificate')
    })

    it('404s when the user does not belong to this company', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(
          actor,
          { userId: 'nonexistent', trainingType: 'x', title: 'y', completionDate: '2026-01-01' },
          {},
        ),
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(
          noCompanyActor,
          { userId: 'staff-1', trainingType: 'x', title: 'y', completionDate: '2026-01-01' },
          {},
        ),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('list()', () => {
    it('includes a live computedStatus per row', async () => {
      const { service } = buildHarness()
      const past = new Date()
      past.setDate(past.getDate() - 5)
      await service.create(
        actor,
        {
          userId: 'staff-1',
          trainingType: 'x',
          title: 'Expired training',
          completionDate: '2025-01-01',
          expiryDate: past.toISOString(),
        },
        {},
      )

      const list = await service.list(actor, { page: 1, limit: 25 })
      expect(list.data[0].computedStatus).toBe('expired')
    })

    // Real-usage report, 19 Aug 2026 — the matrix had no search/filter at
    // all and would become unusable as it grows; mirrors `listProducts()`'s
    // own `q` search precedent (`master-data.service.spec.ts`).
    it("searches by title/trainingType and the staff member's own name/email, matching listProducts()'s own q precedent", async () => {
      const { service, tables } = buildHarness()

      await service.list(actor, { page: 1, limit: 25, q: 'jane' })

      expect(tables.trainingRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { title: { contains: 'jane', mode: 'insensitive' } },
              { trainingType: { contains: 'jane', mode: 'insensitive' } },
              { user: { fullName: { contains: 'jane', mode: 'insensitive' } } },
              { user: { email: { contains: 'jane', mode: 'insensitive' } } },
            ],
          }),
        }),
      )
    })

    it('omits the OR clause entirely when q is blank — never an always-false empty OR', async () => {
      const { service, tables } = buildHarness()

      await service.list(actor, { page: 1, limit: 25, q: '  ' })

      expect(tables.trainingRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'company-1' } }),
      )
    })
  })

  describe('attachCertificate()', () => {
    it('attaches a real certificate document', async () => {
      const { service, tables } = buildHarness()
      const record = await service.create(
        actor,
        { userId: 'staff-1', trainingType: 'x', title: 'y', completionDate: '2026-01-01' },
        {},
      )
      tables.document.rows.set('doc-1', {
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'training_record',
        recordId: record.id,
      })

      const updated = await service.attachCertificate(actor, record.id, { documentId: 'doc-1' }, {})
      expect(updated.certificateDocumentId).toBe('doc-1')
    })

    it('404s on an unscoped document', async () => {
      const { service } = buildHarness()
      const record = await service.create(
        actor,
        { userId: 'staff-1', trainingType: 'x', title: 'y', completionDate: '2026-01-01' },
        {},
      )
      await expect(
        service.attachCertificate(actor, record.id, { documentId: 'nonexistent' }, {}),
      ).rejects.toThrow(NotFoundException)
    })
  })
})
