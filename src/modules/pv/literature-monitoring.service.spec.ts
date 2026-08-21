import { ForbiddenException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { LiteratureMonitoringService } from './literature-monitoring.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const rows: Record<string, unknown>[] = []
  const tables = {
    literatureMonitoringRun: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        rows.push(data)
        return Promise.resolve(data)
      }),
      findMany: jest.fn().mockImplementation(() => Promise.resolve(rows)),
      count: jest.fn().mockImplementation(() => Promise.resolve(rows.length)),
    },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new LiteratureMonitoringService(rls as never, auditService)
  return { service, tables, auditLog }
}

describe('LiteratureMonitoringService', () => {
  describe('logRun()', () => {
    it('persists the run exactly as submitted, attributed to the actor', async () => {
      const { service, tables } = buildHarness()

      const result = await service.logRun(
        actor,
        {
          runAt: '2026-08-10',
          method: 'PubMed manual search',
          searchTerms: 'paracetamol AND hepatotoxicity',
          hitsCount: 3,
          hitsSummary: 'No new safety signals.',
        },
        {},
      )

      expect(result.method).toBe('PubMed manual search')
      expect(result.hitsCount).toBe(3)
      expect(tables.literatureMonitoringRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: 'company-1',
            loggedBy: 'user-1',
            method: 'PubMed manual search',
            hitsCount: 3,
          }),
        }),
      )
    })

    it('audits the run', async () => {
      const { service, auditLog } = buildHarness()
      await service.logRun(
        actor,
        { runAt: '2026-08-10', method: 'Journal review', searchTerms: 'x', hitsCount: 0 },
        {},
      )

      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'literature_monitoring_run_logged' }),
      )
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      const platformActor = { ...actor, companyId: null }
      await expect(
        service.logRun(
          platformActor,
          { runAt: '2026-08-10', method: 'x', searchTerms: 'y', hitsCount: 0 },
          {},
        ),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('list()', () => {
    it("scopes to the actor's own company", async () => {
      const { service, tables } = buildHarness()
      await service.list(actor, { page: 1, limit: 25 })
      expect(tables.literatureMonitoringRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'company-1' } }),
      )
    })
  })
})
