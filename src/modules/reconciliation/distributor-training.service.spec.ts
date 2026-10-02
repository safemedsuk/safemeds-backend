import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import {
  computeDistributorTrainingStatus,
  DistributorTrainingService,
} from './distributor-training.service'

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
    .mockImplementation(
      ({
        where,
        orderBy,
      }: {
        where: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'>
      }) => {
        let list = [...rows.values()].filter((r) => matches(r, where))
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0]
          list = list.sort(
            (a, b) =>
              (new Date(a[field] as string).getTime() - new Date(b[field] as string).getTime()) *
              (dir === 'desc' ? -1 : 1),
          )
        }
        return Promise.resolve(list[0] ?? null)
      },
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
  const count = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> } = {}) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {})).length),
    )
  return { rows, create, findFirst, findMany, update, count }
}

function buildHarness() {
  const tables = {
    distributorTrainingRecord: createTable(),
    distributor: createTable(),
    document: createTable(),
  }
  tables.distributor.rows.set('dist-1', { id: 'dist-1', companyId: 'company-1' })

  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new DistributorTrainingService(rls as never, auditService)
  return { service, tables, auditLog }
}

describe('computeDistributorTrainingStatus()', () => {
  it('is valid when there is no expiry date at all', () => {
    expect(computeDistributorTrainingStatus(null)).toBe('valid')
  })

  it('is valid when far from expiry', () => {
    const far = new Date()
    far.setDate(far.getDate() + 90)
    expect(computeDistributorTrainingStatus(far)).toBe('valid')
  })

  it('is expiring within the 30-day window', () => {
    const soon = new Date()
    soon.setDate(soon.getDate() + 10)
    expect(computeDistributorTrainingStatus(soon)).toBe('expiring')
  })

  it('is expired once past the date', () => {
    const past = new Date()
    past.setDate(past.getDate() - 1)
    expect(computeDistributorTrainingStatus(past)).toBe('expired')
  })
})

describe('DistributorTrainingService (real-usage request, 22 Sep 2026, item 6)', () => {
  describe('create()', () => {
    it('logs a training record for a real distributor', async () => {
      const { service } = buildHarness()
      const record = await service.create(
        actor,
        {
          distributorId: 'dist-1',
          trainingType: 'pv_annual',
          title: 'Annual PV/Reporting-Obligations Training 2026',
          completionDate: '2026-01-01',
        },
        {},
      )
      expect(record.trainingType).toBe('pv_annual')
    })

    it('404s when the distributor does not belong to this company', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(
          actor,
          { distributorId: 'nonexistent', trainingType: 'x', title: 'y', completionDate: '2026-01-01' },
          {},
        ),
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(
          noCompanyActor,
          { distributorId: 'dist-1', trainingType: 'x', title: 'y', completionDate: '2026-01-01' },
          {},
        ),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('attachCertificate()', () => {
    it('links a real, company-scoped document already uploaded against this record', async () => {
      const { service, tables } = buildHarness()
      const record = await service.create(
        actor,
        { distributorId: 'dist-1', trainingType: 'x', title: 'y', completionDate: '2026-01-01' },
        {},
      )
      tables.document.rows.set('doc-1', {
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'distributor_training_record',
        recordId: record.id,
      })

      const updated = await service.attachCertificate(actor, record.id, { documentId: 'doc-1' }, {})
      expect(updated.certificateDocumentId).toBe('doc-1')
    })

    it('404s when the document was never uploaded against this specific record', async () => {
      const { service } = buildHarness()
      const record = await service.create(
        actor,
        { distributorId: 'dist-1', trainingType: 'x', title: 'y', completionDate: '2026-01-01' },
        {},
      )
      await expect(
        service.attachCertificate(actor, record.id, { documentId: 'doc-nonexistent' }, {}),
      ).rejects.toThrow(NotFoundException)
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
          distributorId: 'dist-1',
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

    it('filters by distributorId when given', async () => {
      const { service, tables } = buildHarness()
      tables.distributor.rows.set('dist-2', { id: 'dist-2', companyId: 'company-1' })
      await service.create(
        actor,
        { distributorId: 'dist-1', trainingType: 'x', title: 'y', completionDate: '2026-01-01' },
        {},
      )
      await service.create(
        actor,
        { distributorId: 'dist-2', trainingType: 'x', title: 'z', completionDate: '2026-01-01' },
        {},
      )

      const list = await service.list(actor, { page: 1, limit: 25, distributorId: 'dist-2' })
      expect(list.data).toHaveLength(1)
      expect(list.data[0].title).toBe('z')
    })
  })

  describe('getStatusForDistributor() — the real "trained annually" flag', () => {
    it('returns missing when no training has ever been logged', async () => {
      const { service } = buildHarness()
      const status = await service.getStatusForDistributor(actor, 'dist-1')
      expect(status.status).toBe('missing')
    })

    it('returns the most recent record\'s own computed status', async () => {
      const { service } = buildHarness()
      const farFuture = new Date()
      farFuture.setDate(farFuture.getDate() + 300)
      await service.create(
        actor,
        {
          distributorId: 'dist-1',
          trainingType: 'pv_annual',
          title: 'Annual training',
          completionDate: '2026-01-01',
          expiryDate: farFuture.toISOString(),
        },
        {},
      )

      const status = await service.getStatusForDistributor(actor, 'dist-1')
      expect(status.status).toBe('valid')
      expect(status.record?.title).toBe('Annual training')
    })

    it('picks the most recent completion when several records exist', async () => {
      const { service } = buildHarness()
      await service.create(
        actor,
        { distributorId: 'dist-1', trainingType: 'pv_annual', title: 'Old', completionDate: '2024-01-01' },
        {},
      )
      await service.create(
        actor,
        { distributorId: 'dist-1', trainingType: 'pv_annual', title: 'Recent', completionDate: '2026-01-01' },
        {},
      )

      const status = await service.getStatusForDistributor(actor, 'dist-1')
      expect(status.record?.title).toBe('Recent')
    })
  })
})
