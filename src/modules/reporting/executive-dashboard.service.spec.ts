import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ExecutiveDashboardService } from './executive-dashboard.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_MANAGER'],
  platformRole: null,
  tokenVersion: 1,
}

describe('ExecutiveDashboardService', () => {
  it('composes the dashboard, cross-module readiness, and a 10-item obligations preview', async () => {
    const dashboard = { cases: { totalOpen: 0 } }
    const readiness = { vigicloud: { overall: 'green' } }
    const obligations = Array.from({ length: 15 }, (_, i) => ({ dueAt: `2026-01-0${(i % 9) + 1}`, kind: 'x' }))

    const dashboardService = { getDashboard: jest.fn().mockResolvedValue(dashboard) } as never
    const crossModuleReadinessService = { getReadiness: jest.fn().mockResolvedValue(readiness) } as never
    const obligationsFeedService = { getFeed: jest.fn().mockResolvedValue(obligations) } as never

    const service = new ExecutiveDashboardService(dashboardService, crossModuleReadinessService, obligationsFeedService)
    const result = await service.getExecutiveDashboard(actor)

    expect(result.dashboard).toBe(dashboard)
    expect(result.readiness).toBe(readiness)
    expect(result.topObligations).toHaveLength(10)
    expect(result.topObligations).toEqual(obligations.slice(0, 10))
  })
})
