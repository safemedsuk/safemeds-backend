import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ReportsService } from './reports.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
  platformRole: null,
  tokenVersion: 1,
}

interface ReportRow {
  id: string
  companyId: string
  moduleKey: string
  reportTypeKey: string
  title: string
  status: 'draft' | 'final' | 'submitted'
  dueAt: Date | null
  submittedAt: Date | null
  createdAt: Date
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const rows = new Map<string, ReportRow>()
  let seq = 0

  const create = jest
    .fn()
    .mockImplementation(
      ({
        data,
      }: {
        data: Omit<ReportRow, 'createdAt' | 'submittedAt'> & { submittedAt?: Date }
      }) => {
        seq += 1
        const row: ReportRow = {
          ...data,
          submittedAt: data.submittedAt ?? null,
          createdAt: new Date(Date.now() + seq),
        }
        rows.set(row.id, row)
        return Promise.resolve(row)
      },
    )
  const findFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: { id: string; companyId: string } }) => {
      const row = rows.get(where.id)
      return Promise.resolve(row && row.companyId === where.companyId ? row : null)
    })
  const findMany = jest
    .fn()
    .mockImplementation(
      ({
        where,
        skip = 0,
        take = 25,
      }: {
        where: { companyId: string; moduleKey?: string; status?: string }
        skip?: number
        take?: number
      }) => {
        let filtered = [...rows.values()].filter((r) => r.companyId === where.companyId)
        if (where.moduleKey) filtered = filtered.filter((r) => r.moduleKey === where.moduleKey)
        if (where.status) filtered = filtered.filter((r) => r.status === where.status)
        filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        return Promise.resolve(filtered.slice(skip, skip + take))
      },
    )
  const count = jest
    .fn()
    .mockImplementation(
      ({ where }: { where: { companyId: string; moduleKey?: string; status?: string } }) => {
        let filtered = [...rows.values()].filter((r) => r.companyId === where.companyId)
        if (where.moduleKey) filtered = filtered.filter((r) => r.moduleKey === where.moduleKey)
        if (where.status) filtered = filtered.filter((r) => r.status === where.status)
        return Promise.resolve(filtered.length)
      },
    )
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<ReportRow> }) => {
      const row = rows.get(where.id)!
      const updated = { ...row, ...data }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })

  const workflowInstanceRows = new Map<string, { recordType: string; recordId: string }>()
  const workflowInstanceFindFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: { recordType: string; recordId: string } }) =>
      Promise.resolve(
        [...workflowInstanceRows.values()].find(
          (r) => r.recordType === where.recordType && r.recordId === where.recordId,
        ) ?? null,
      ),
    )

  const tables = {
    generatedReport: { create, findFirst, findMany, count, update },
    workflowInstance: { findFirst: workflowInstanceFindFirst },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new ReportsService(rls as never, auditService)
  return { service, rows, auditLog, workflowInstanceRows }
}

describe('ReportsService', () => {
  describe('create()', () => {
    it('creates a draft report and audits it', async () => {
      const { service, auditLog } = buildHarness()
      const report = await service.create(
        actor,
        { moduleKey: 'pv', reportTypeKey: 'psur', title: 'Q1 PSUR' },
        {},
      )

      expect(report.status).toBe('draft')
      expect(report.moduleKey).toBe('pv')
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'generated_report_created' }),
      )
    })

    it('rejects a platform-staff actor with no company context', async () => {
      const { service } = buildHarness()
      const platformActor: AuthenticatedUser = {
        sub: 'staff-1',
        companyId: null,
        roleKeys: [],
        platformRole: 'super_admin',
        tokenVersion: 1,
      }
      await expect(
        service.create(
          platformActor,
          { moduleKey: 'pv', reportTypeKey: 'psur', title: 'Q1 PSUR' },
          {},
        ),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('list()', () => {
    it('filters by moduleKey and status, paginating newest-first', async () => {
      const { service } = buildHarness()
      await service.create(
        actor,
        { moduleKey: 'pv', reportTypeKey: 'psur', title: 'PV report 1' },
        {},
      )
      await service.create(
        actor,
        { moduleKey: 'qualcloud', reportTypeKey: 'batch_release', title: 'Quality report' },
        {},
      )
      const pv2 = await service.create(
        actor,
        { moduleKey: 'pv', reportTypeKey: 'psur', title: 'PV report 2' },
        {},
      )
      await service.finalize(actor, pv2.id, {})

      const allPv = await service.list(actor, { page: 1, limit: 25, moduleKey: 'pv' })
      expect(allPv.data).toHaveLength(2)

      const finalOnly = await service.list(actor, {
        page: 1,
        limit: 25,
        moduleKey: 'pv',
        status: 'final',
      } as never)
      expect(finalOnly.data).toHaveLength(1)
      expect(finalOnly.data[0].id).toBe(pv2.id)
    })
  })

  describe('get()', () => {
    it('404s a report from another company', async () => {
      const { service } = buildHarness()
      const created = await service.create(
        actor,
        { moduleKey: 'pv', reportTypeKey: 'psur', title: 'Q1 PSUR' },
        {},
      )
      const otherCompanyActor: AuthenticatedUser = { ...actor, companyId: 'company-2' }
      await expect(service.get(otherCompanyActor, created.id)).rejects.toThrow(NotFoundException)
    })
  })

  describe('finalize()', () => {
    it('moves a draft to final and audits it', async () => {
      const { service, auditLog } = buildHarness()
      const created = await service.create(
        actor,
        { moduleKey: 'pv', reportTypeKey: 'psur', title: 'Q1 PSUR' },
        {},
      )
      const finalized = await service.finalize(actor, created.id, {})

      expect(finalized.status).toBe('final')
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'generated_report_finalized' }),
      )
    })

    it('refuses to finalize a report that is already final', async () => {
      const { service } = buildHarness()
      const created = await service.create(
        actor,
        { moduleKey: 'pv', reportTypeKey: 'psur', title: 'Q1 PSUR' },
        {},
      )
      await service.finalize(actor, created.id, {})
      await expect(service.finalize(actor, created.id, {})).rejects.toThrow(ConflictException)
    })

    it('refuses to finalize a report that has its own periodic_report workflow instance — real-usage request, 11 Sep 2026', async () => {
      const { service, workflowInstanceRows } = buildHarness()
      const created = await service.create(
        actor,
        { moduleKey: 'pv', reportTypeKey: 'psur', title: 'Q1 PSUR' },
        {},
      )
      workflowInstanceRows.set('instance-1', {
        recordType: 'periodic_report',
        recordId: created.id,
      })

      await expect(service.finalize(actor, created.id, {})).rejects.toThrow(ConflictException)
    })
  })

  describe('submit()', () => {
    it('moves a final report to submitted, stamping submittedAt', async () => {
      const { service } = buildHarness()
      const created = await service.create(
        actor,
        { moduleKey: 'pv', reportTypeKey: 'psur', title: 'Q1 PSUR' },
        {},
      )
      await service.finalize(actor, created.id, {})
      const submitted = await service.submit(actor, created.id, {})

      expect(submitted.status).toBe('submitted')
      expect(submitted.submittedAt).toBeInstanceOf(Date)
    })

    it('refuses to submit a report still in draft', async () => {
      const { service } = buildHarness()
      const created = await service.create(
        actor,
        { moduleKey: 'pv', reportTypeKey: 'psur', title: 'Q1 PSUR' },
        {},
      )
      await expect(service.submit(actor, created.id, {})).rejects.toThrow(ConflictException)
    })

    it('refuses to submit a report that has its own periodic_report workflow instance, even once final', async () => {
      const { service, workflowInstanceRows } = buildHarness()
      const created = await service.create(
        actor,
        { moduleKey: 'pv', reportTypeKey: 'psur', title: 'Q1 PSUR' },
        {},
      )
      await service.finalize(actor, created.id, {})
      workflowInstanceRows.set('instance-1', {
        recordType: 'periodic_report',
        recordId: created.id,
      })

      await expect(service.submit(actor, created.id, {})).rejects.toThrow(ConflictException)
    })
  })
})
