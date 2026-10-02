import { ForbiddenException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ObligationsFeedService } from './obligations-feed.service'

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

function buildHarness(fixtures: {
  deadlines?: Record<string, unknown>[]
  regDeadlines?: Record<string, unknown>[]
  obligations?: Record<string, unknown>[]
  capas?: Record<string, unknown>[]
  equipment?: Record<string, unknown>[]
  trainingRecords?: Record<string, unknown>[]
}) {
  const tx = {
    deadline: { findMany: jest.fn().mockResolvedValue(fixtures.deadlines ?? []) },
    regDeadline: { findMany: jest.fn().mockResolvedValue(fixtures.regDeadlines ?? []) },
    regPostMarketObligation: { findMany: jest.fn().mockResolvedValue(fixtures.obligations ?? []) },
    capa: { findMany: jest.fn().mockResolvedValue(fixtures.capas ?? []) },
    equipment: { findMany: jest.fn().mockResolvedValue(fixtures.equipment ?? []) },
    trainingRecord: { findMany: jest.fn().mockResolvedValue(fixtures.trainingRecords ?? []) },
  }
  const rls = { runAsCompany: (_companyId: string, fn: (t: typeof tx) => unknown) => fn(tx) }
  return { service: new ObligationsFeedService(rls as never), tx }
}

describe('ObligationsFeedService', () => {
  it('rejects an actor with no company', async () => {
    const { service } = buildHarness({})
    await expect(service.getFeed(noCompanyActor)).rejects.toThrow(ForbiddenException)
  })

  it('returns an empty feed when nothing is due anywhere', async () => {
    const { service } = buildHarness({})
    const feed = await service.getFeed(actor)
    expect(feed).toEqual([])
  })

  it('merges every module\'s own clock into one chronologically sorted feed', async () => {
    const now = new Date()
    const soon = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000)
    const sooner = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)
    const overdue = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)

    const { service } = buildHarness({
      deadlines: [{ recordType: 'pv_case', recordId: 'case-1', dueAt: soon, status: 'pending' }],
      capas: [{ id: 'capa-1', title: 'Fix the line', dueDate: sooner, status: 'open' }],
      equipment: [
        { id: 'eq-1', name: 'Autoclave', calibrationDueAt: overdue, maintenanceDueAt: null, isActive: true },
      ],
    })

    const feed = await service.getFeed(actor)
    expect(feed).toHaveLength(3)
    // Sorted chronologically — the overdue equipment calibration comes first.
    expect(feed[0].kind).toBe('equipment_calibration')
    expect(feed[0].overdue).toBe(true)
    expect(feed[1].kind).toBe('capa_due')
    expect(feed[2].kind).toBe('pv_reporting_deadline')
    expect(feed.every((item) => item.module)).toBeTruthy()
  })

  it('skips a CAPA with no dueDate rather than crashing', async () => {
    const { service } = buildHarness({ capas: [{ id: 'capa-1', title: 'No date', dueDate: null, status: 'open' }] })
    const feed = await service.getFeed(actor)
    expect(feed).toEqual([])
  })
})
