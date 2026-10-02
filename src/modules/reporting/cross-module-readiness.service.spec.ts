import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CrossModuleReadinessService } from './cross-module-readiness.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_MANAGER'],
  platformRole: null,
  tokenVersion: 1,
}

describe('CrossModuleReadinessService', () => {
  it('composes the three already-built dashboard services without re-querying anything itself', async () => {
    const getDashboard = jest.fn().mockResolvedValue({
      regulatory: {
        openItems: {
          overduePostMarketObligations: [{}],
          longOpenQueries: [],
          registrationsExpiringSoonWithNoRenewalStarted: [],
          retentionsDueNotLogged: [],
        },
      },
    })
    const auditReadinessService = {
      getDashboard: jest.fn().mockResolvedValue({ overall: 'green', readyCount: 15, totalMandatory: 15 }),
    } as never
    const inspectionReadinessService = {
      getSnapshot: jest.fn().mockResolvedValue({ overall: 'ready', authorityConfigured: true }),
    } as never
    const dashboardService = { getDashboard } as never

    const service = new CrossModuleReadinessService(auditReadinessService, inspectionReadinessService, dashboardService)
    const readiness = await service.getReadiness(actor)

    expect(readiness.vigicloud).toEqual({ overall: 'green', readyCount: 15, totalMandatory: 15 })
    expect(readiness.qualcloud).toEqual({ overall: 'ready', authorityConfigured: true })
    expect(readiness.regulatory).toEqual({ openItemCount: 1, overall: 'needs_attention' })
  })

  it('reports regulatory as ready when nothing is open', async () => {
    const getDashboard = jest.fn().mockResolvedValue({
      regulatory: {
        openItems: {
          overduePostMarketObligations: [],
          longOpenQueries: [],
          registrationsExpiringSoonWithNoRenewalStarted: [],
          retentionsDueNotLogged: [],
        },
      },
    })
    const auditReadinessService = { getDashboard: jest.fn().mockResolvedValue({ overall: 'green', readyCount: 0, totalMandatory: 0 }) } as never
    const inspectionReadinessService = { getSnapshot: jest.fn().mockResolvedValue({ overall: 'ready', authorityConfigured: false }) } as never
    const dashboardService = { getDashboard } as never

    const service = new CrossModuleReadinessService(auditReadinessService, inspectionReadinessService, dashboardService)
    const readiness = await service.getReadiness(actor)

    expect(readiness.regulatory).toEqual({ openItemCount: 0, overall: 'ready' })
  })
})
