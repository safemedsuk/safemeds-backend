import { ForbiddenException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RecordVersioningService } from './record-versioning.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
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

interface VersionRow {
  id: string
  companyId: string
  recordType: string
  recordId: string
  versionNumber: number
  reason: string | null
  snapshot: unknown
  previousVersionId: string | null
  capturedBy: string | null
  capturedAt: Date
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const rows = new Map<string, VersionRow>()
  let counter = 0

  const findFirst = jest
    .fn()
    .mockImplementation(
      ({
        where,
        orderBy,
      }: {
        where: { recordType: string; recordId: string }
        orderBy: { versionNumber: 'desc' }
      }) => {
        let matches = [...rows.values()].filter(
          (r) => r.recordType === where.recordType && r.recordId === where.recordId,
        )
        if (orderBy.versionNumber === 'desc')
          matches = matches.sort((a, b) => b.versionNumber - a.versionNumber)
        return Promise.resolve(matches[0] ?? null)
      },
    )
  const create = jest
    .fn()
    .mockImplementation(({ data }: { data: Omit<VersionRow, 'capturedAt'> }) => {
      const row: VersionRow = { ...data, capturedAt: new Date(Date.now() + counter++) }
      rows.set(row.id, row)
      return Promise.resolve(row)
    })
  const findMany = jest
    .fn()
    .mockImplementation(
      ({
        where,
        skip,
        take,
      }: {
        where: { companyId: string; recordType: string; recordId: string }
        skip: number
        take: number
      }) => {
        const matches = [...rows.values()]
          .filter(
            (r) =>
              r.companyId === where.companyId &&
              r.recordType === where.recordType &&
              r.recordId === where.recordId,
          )
          .sort((a, b) => b.versionNumber - a.versionNumber)
        return Promise.resolve(matches.slice(skip, skip + take))
      },
    )
  const count = jest
    .fn()
    .mockImplementation(
      ({ where }: { where: { companyId: string; recordType: string; recordId: string } }) => {
        return Promise.resolve(
          [...rows.values()].filter(
            (r) =>
              r.companyId === where.companyId &&
              r.recordType === where.recordType &&
              r.recordId === where.recordId,
          ).length,
        )
      },
    )

  const tables = { recordVersion: { findFirst, create, findMany, count } }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new RecordVersioningService(rls as never, auditService)
  return { service, rows, auditLog }
}

describe('RecordVersioningService', () => {
  it('rejects a platform-staff actor with no company context', async () => {
    const { service } = buildHarness()
    await expect(
      service.createVersion(
        platformActor,
        { recordType: 'pv_case', recordId: 'case-1', snapshot: {} },
        {},
      ),
    ).rejects.toThrow(ForbiddenException)
  })

  it('the first captured version for a record is versionNumber 1 with no previousVersionId', async () => {
    const { service } = buildHarness()
    const v1 = await service.createVersion(
      actor,
      { recordType: 'pv_case', recordId: 'case-1', snapshot: { status: 'intake' } },
      {},
    )
    expect(v1.versionNumber).toBe(1)
    expect(v1.previousVersionId).toBeNull()
  })

  it('each subsequent version increments and chains to the previous one', async () => {
    const { service } = buildHarness()
    const v1 = await service.createVersion(
      actor,
      { recordType: 'pv_case', recordId: 'case-1', snapshot: { status: 'intake' } },
      {},
    )
    const v2 = await service.createVersion(
      actor,
      {
        recordType: 'pv_case',
        recordId: 'case-1',
        snapshot: { status: 'triage' },
        reason: 'triaged',
      },
      {},
    )
    const v3 = await service.createVersion(
      actor,
      { recordType: 'pv_case', recordId: 'case-1', snapshot: { status: 'coding' } },
      {},
    )

    expect(v2.versionNumber).toBe(2)
    expect(v2.previousVersionId).toBe(v1.id)
    expect(v3.versionNumber).toBe(3)
    expect(v3.previousVersionId).toBe(v2.id)
  })

  it('versioning is independent per (recordType, recordId) pair', async () => {
    const { service } = buildHarness()
    await service.createVersion(
      actor,
      { recordType: 'pv_case', recordId: 'case-1', snapshot: {} },
      {},
    )
    const otherRecordV1 = await service.createVersion(
      actor,
      { recordType: 'pv_case', recordId: 'case-2', snapshot: {} },
      {},
    )
    expect(otherRecordV1.versionNumber).toBe(1)
  })

  it('audits every capture', async () => {
    const { service, auditLog } = buildHarness()
    await service.createVersion(
      actor,
      { recordType: 'pv_case', recordId: 'case-1', snapshot: {}, reason: 'initial capture' },
      {},
    )
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'record_version_captured' }),
    )
  })

  it('history() returns newest-first and paginates', async () => {
    const { service } = buildHarness()
    await service.createVersion(
      actor,
      { recordType: 'pv_case', recordId: 'case-1', snapshot: { n: 1 } },
      {},
    )
    await service.createVersion(
      actor,
      { recordType: 'pv_case', recordId: 'case-1', snapshot: { n: 2 } },
      {},
    )

    const page = await service.history(actor, 'pv_case', 'case-1', { page: 1, limit: 25 })
    expect(page.data).toHaveLength(2)
    expect(page.data[0].versionNumber).toBe(2)
    expect(page.meta.total).toBe(2)
  })
})
