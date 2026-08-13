import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ConsentService } from './consent.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
  platformRole: null,
  tokenVersion: 1,
}

const otherCompanyActor: AuthenticatedUser = { ...actor, sub: 'user-2', companyId: 'company-2' }

const platformActor: AuthenticatedUser = {
  sub: 'staff-1',
  companyId: null,
  roleKeys: [],
  platformRole: 'super_admin',
  tokenVersion: 1,
}

interface ConsentRow {
  id: string
  companyId: string
  recordType: string
  recordId: string
  consentType: string
  granted: boolean
  method: string
  formVersion: number
  capturedBy: string | null
  grantedAt: Date | null
  withdrawnAt: Date | null
  createdAt: Date
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const rows = new Map<string, ConsentRow>()
  let counter = 0

  const create = jest
    .fn()
    .mockImplementation(({ data }: { data: Omit<ConsentRow, 'createdAt'> }) => {
      const row: ConsentRow = { ...data, createdAt: new Date(Date.now() + counter++) }
      rows.set(row.id, row)
      return Promise.resolve(row)
    })
  const findFirst = jest
    .fn()
    .mockImplementation(
      ({ where, orderBy }: { where: Partial<ConsentRow>; orderBy?: { createdAt: 'desc' } }) => {
        let matches = [...rows.values()].filter((r) =>
          Object.entries(where).every(
            ([key, value]) => value === undefined || r[key as keyof ConsentRow] === value,
          ),
        )
        if (orderBy?.createdAt === 'desc') {
          matches = matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        }
        return Promise.resolve(matches[0] ?? null)
      },
    )
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<ConsentRow> }) => {
      const existing = rows.get(where.id)!
      const updated = { ...existing, ...data }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })
  const findMany = jest
    .fn()
    .mockImplementation(
      ({ where, skip, take }: { where: Partial<ConsentRow>; skip: number; take: number }) => {
        const matches = [...rows.values()]
          .filter((r) =>
            Object.entries(where).every(
              ([key, value]) => value === undefined || r[key as keyof ConsentRow] === value,
            ),
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        return Promise.resolve(matches.slice(skip, skip + take))
      },
    )
  const count = jest.fn().mockImplementation(({ where }: { where: Partial<ConsentRow> }) => {
    return Promise.resolve(
      [...rows.values()].filter((r) =>
        Object.entries(where).every(
          ([key, value]) => value === undefined || r[key as keyof ConsentRow] === value,
        ),
      ).length,
    )
  })

  const tables = { consentRecord: { create, findFirst, update, findMany, count } }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new ConsentService(rls as never, auditService)
  return { service, rows, auditLog }
}

describe('ConsentService', () => {
  it('capture() creates a granted record and audits it', async () => {
    const { service, auditLog } = buildHarness()

    const record = await service.capture(
      actor,
      {
        recordType: 'pv_case',
        recordId: 'case-1',
        consentType: 'contact',
        granted: true,
        method: 'written',
      },
      {},
    )

    expect(record.granted).toBe(true)
    expect(record.grantedAt).not.toBeNull()
    expect(record.capturedBy).toBe(actor.sub)
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'consent_captured' }),
    )
  })

  it('capture() records a declined consent with no grantedAt', async () => {
    const { service } = buildHarness()
    const record = await service.capture(
      actor,
      {
        recordType: 'pv_case',
        recordId: 'case-1',
        consentType: 'contact',
        granted: false,
        method: 'verbal',
      },
      {},
    )
    expect(record.granted).toBe(false)
    expect(record.grantedAt).toBeNull()
  })

  it('capture() rejects a platform-staff actor with no company context', async () => {
    const { service } = buildHarness()
    await expect(
      service.capture(
        platformActor,
        {
          recordType: 'pv_case',
          recordId: 'case-1',
          consentType: 'contact',
          granted: true,
          method: 'written',
        },
        {},
      ),
    ).rejects.toThrow(ForbiddenException)
  })

  it('withdraw() sets withdrawnAt and audits it', async () => {
    const { service, auditLog } = buildHarness()
    const record = await service.capture(
      actor,
      {
        recordType: 'pv_case',
        recordId: 'case-1',
        consentType: 'contact',
        granted: true,
        method: 'written',
      },
      {},
    )

    const withdrawn = await service.withdraw(actor, record.id, {})
    expect(withdrawn.withdrawnAt).not.toBeNull()
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'consent_withdrawn' }),
    )
  })

  it('withdraw() 404s on a record from another company', async () => {
    const { service } = buildHarness()
    const record = await service.capture(
      actor,
      {
        recordType: 'pv_case',
        recordId: 'case-1',
        consentType: 'contact',
        granted: true,
        method: 'written',
      },
      {},
    )
    await expect(service.withdraw(otherCompanyActor, record.id, {})).rejects.toThrow(
      NotFoundException,
    )
  })

  it('withdraw() 409s if already withdrawn', async () => {
    const { service } = buildHarness()
    const record = await service.capture(
      actor,
      {
        recordType: 'pv_case',
        recordId: 'case-1',
        consentType: 'contact',
        granted: true,
        method: 'written',
      },
      {},
    )
    await service.withdraw(actor, record.id, {})
    await expect(service.withdraw(actor, record.id, {})).rejects.toThrow(ConflictException)
  })

  it('check() returns hasRecord:false, granted:null when nothing was ever captured', async () => {
    const { service } = buildHarness()
    const result = await service.check(actor, 'pv_case', 'case-never-touched', 'contact')
    expect(result).toEqual({ hasRecord: false, granted: null, record: null })
  })

  it('check() returns granted:true for a live granted record', async () => {
    const { service } = buildHarness()
    await service.capture(
      actor,
      {
        recordType: 'pv_case',
        recordId: 'case-1',
        consentType: 'contact',
        granted: true,
        method: 'written',
      },
      {},
    )
    const result = await service.check(actor, 'pv_case', 'case-1', 'contact')
    expect(result.hasRecord).toBe(true)
    expect(result.granted).toBe(true)
  })

  it('check() returns granted:false once a granted record is withdrawn', async () => {
    const { service } = buildHarness()
    const record = await service.capture(
      actor,
      {
        recordType: 'pv_case',
        recordId: 'case-1',
        consentType: 'contact',
        granted: true,
        method: 'written',
      },
      {},
    )
    await service.withdraw(actor, record.id, {})

    const result = await service.check(actor, 'pv_case', 'case-1', 'contact')
    expect(result.hasRecord).toBe(true)
    expect(result.granted).toBe(false)
  })

  it('check() looks at the most recent record when several exist for the same target', async () => {
    const { service } = buildHarness()
    await service.capture(
      actor,
      {
        recordType: 'pv_case',
        recordId: 'case-1',
        consentType: 'contact',
        granted: false,
        method: 'verbal',
      },
      {},
    )
    await service.capture(
      actor,
      {
        recordType: 'pv_case',
        recordId: 'case-1',
        consentType: 'contact',
        granted: true,
        method: 'written',
      },
      {},
    )

    const result = await service.check(actor, 'pv_case', 'case-1', 'contact')
    expect(result.granted).toBe(true)
  })

  it('list() paginates and filters by recordType/recordId', async () => {
    const { service } = buildHarness()
    await service.capture(
      actor,
      {
        recordType: 'pv_case',
        recordId: 'case-1',
        consentType: 'contact',
        granted: true,
        method: 'written',
      },
      {},
    )
    await service.capture(
      actor,
      {
        recordType: 'pv_case',
        recordId: 'case-2',
        consentType: 'report',
        granted: true,
        method: 'implied',
      },
      {},
    )

    const page = await service.list(actor, {
      page: 1,
      limit: 25,
      recordType: 'pv_case',
      recordId: 'case-1',
    })
    expect(page.data).toHaveLength(1)
    expect(page.data[0].recordId).toBe('case-1')
    expect(page.meta.total).toBe(1)
  })
})
