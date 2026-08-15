import { ForbiddenException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { DataSubjectRequestService } from './data-subject-request.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['SYSTEM_ADMINISTRATOR'],
  platformRole: null,
  tokenVersion: 1,
}

const platformActor: AuthenticatedUser = {
  sub: 'staff-1',
  companyId: null,
  roleKeys: [],
  platformRole: 'super_admin',
  tokenVersion: 1,
}

interface DsrRow {
  id: string
  companyId: string
  recordType: string
  recordId: string
  requestType: string
  status: string
  requestedBy: string
  blockedReason: string | null
  completedAt: Date | null
  createdAt: Date
}

interface DeadlineRow {
  recordType: string
  recordId: string
  status: string
}

function buildHarness(seedDeadlines: DeadlineRow[] = []) {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const dsrRows = new Map<string, DsrRow>()
  let counter = 0

  const dsrCreate = jest
    .fn()
    .mockImplementation(
      ({
        data,
      }: {
        data: Omit<DsrRow, 'status' | 'blockedReason' | 'completedAt' | 'createdAt'>
      }) => {
        const row: DsrRow = {
          ...data,
          status: 'pending',
          blockedReason: null,
          completedAt: null,
          createdAt: new Date(Date.now() + counter++),
        }
        dsrRows.set(row.id, row)
        return Promise.resolve(row)
      },
    )
  const dsrUpdate = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<DsrRow> }) => {
      const existing = dsrRows.get(where.id)!
      const updated = { ...existing, ...data }
      dsrRows.set(where.id, updated)
      return Promise.resolve(updated)
    })
  const dsrFindMany = jest
    .fn()
    .mockImplementation(
      ({ where, skip, take }: { where: Partial<DsrRow>; skip: number; take: number }) => {
        const matches = [...dsrRows.values()]
          .filter((r) =>
            Object.entries(where).every(
              ([key, value]) => value === undefined || r[key as keyof DsrRow] === value,
            ),
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        return Promise.resolve(matches.slice(skip, skip + take))
      },
    )
  const dsrCount = jest.fn().mockImplementation(({ where }: { where: Partial<DsrRow> }) => {
    return Promise.resolve(
      [...dsrRows.values()].filter((r) =>
        Object.entries(where).every(
          ([key, value]) => value === undefined || r[key as keyof DsrRow] === value,
        ),
      ).length,
    )
  })

  const deadlineFindFirst = jest
    .fn()
    .mockImplementation(
      ({ where }: { where: { recordType: string; recordId: string; status: string } }) => {
        const match = seedDeadlines.find(
          (d) =>
            d.recordType === where.recordType &&
            d.recordId === where.recordId &&
            d.status === where.status,
        )
        return Promise.resolve(match ?? null)
      },
    )

  const tables = {
    dataSubjectRequest: {
      create: dsrCreate,
      update: dsrUpdate,
      findMany: dsrFindMany,
      count: dsrCount,
    },
    deadline: { findFirst: deadlineFindFirst },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new DataSubjectRequestService(rls as never, auditService)
  return { service, dsrRows, auditLog }
}

describe('DataSubjectRequestService', () => {
  it('rejects a platform-staff actor with no company context', async () => {
    const { service } = buildHarness()
    await expect(
      service.request(
        platformActor,
        { recordType: 'pv_case', recordId: 'case-1', requestType: 'export' },
        {},
      ),
    ).rejects.toThrow(ForbiddenException)
  })

  it('an export request completes immediately (no blocking concept)', async () => {
    const { service, auditLog } = buildHarness()
    const result = await service.request(
      actor,
      { recordType: 'pv_case', recordId: 'case-1', requestType: 'export' },
      {},
    )

    expect(result.status).toBe('completed')
    expect(result.completedAt).not.toBeNull()
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'data_subject_request_created' }),
    )
  })

  it('an erasure request completes immediately when there is no open Deadline for that record', async () => {
    const { service } = buildHarness([])
    const result = await service.request(
      actor,
      { recordType: 'pv_case', recordId: 'case-1', requestType: 'erasure' },
      {},
    )

    expect(result.status).toBe('completed')
    expect(result.blockedReason).toBeNull()
  })

  it('an erasure request is blocked when an open Deadline exists for that exact record', async () => {
    const { service } = buildHarness([
      { recordType: 'pv_case', recordId: 'case-1', status: 'pending' },
    ])
    const result = await service.request(
      actor,
      { recordType: 'pv_case', recordId: 'case-1', requestType: 'erasure' },
      {},
    )

    expect(result.status).toBe('blocked')
    expect(result.blockedReason).toContain('open regulatory deadline')
  })

  it('an erasure request is NOT blocked by a Deadline for a different record', async () => {
    const { service } = buildHarness([
      { recordType: 'pv_case', recordId: 'case-OTHER', status: 'pending' },
    ])
    const result = await service.request(
      actor,
      { recordType: 'pv_case', recordId: 'case-1', requestType: 'erasure' },
      {},
    )

    expect(result.status).toBe('completed')
  })

  it('an erasure request is NOT blocked by a Deadline that has already been met (not pending)', async () => {
    const { service } = buildHarness([{ recordType: 'pv_case', recordId: 'case-1', status: 'met' }])
    const result = await service.request(
      actor,
      { recordType: 'pv_case', recordId: 'case-1', requestType: 'erasure' },
      {},
    )

    expect(result.status).toBe('completed')
  })

  it('list() filters by status', async () => {
    const { service } = buildHarness([
      { recordType: 'pv_case', recordId: 'case-blocked', status: 'pending' },
    ])
    await service.request(
      actor,
      { recordType: 'pv_case', recordId: 'case-blocked', requestType: 'erasure' },
      {},
    )
    await service.request(
      actor,
      { recordType: 'pv_case', recordId: 'case-open', requestType: 'export' },
      {},
    )

    const blocked = await service.list(actor, { page: 1, limit: 25, status: 'blocked' })
    expect(blocked.data).toHaveLength(1)
    expect(blocked.data[0].recordId).toBe('case-blocked')
  })
})
