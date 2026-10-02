import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { MockRecallReadinessService } from './mock-recall-readiness.service'

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

const RECALL_ID = 'recall-1'
const HOUR = 1000 * 60 * 60

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * HOUR)
}

function buildHarness(overrides: { recall?: Record<string, unknown>; links?: unknown[]; cascadeInvites?: unknown[] } = {}) {
  const recallFindFirst = jest
    .fn()
    .mockResolvedValue({ id: RECALL_ID, companyId: 'company-1', mode: 'mock', ref: 'MOCK-2026-001', ...overrides.recall })
  const linkFindMany = jest.fn().mockResolvedValue(overrides.links ?? [])
  const cascadeFindMany = jest.fn().mockResolvedValue(overrides.cascadeInvites ?? [])
  const generatedReportCreate = jest.fn().mockResolvedValue({ id: 'report-1' })

  const tables = {
    recall: { findFirst: recallFindFirst },
    recallPortalLink: { findMany: linkFindMany },
    recallCascadeInvite: { findMany: cascadeFindMany },
    generatedReport: { create: generatedReportCreate },
  }
  const rls = { runAsCompany: (_c: string, fn: (tx: typeof tables) => unknown) => fn(tables) }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const uploadDirect = jest.fn().mockResolvedValue({ document: { id: 'doc-1' } })
  const documentsService = { uploadDirect } as never

  const service = new MockRecallReadinessService(rls as never, auditService, documentsService)
  return { service, recallFindFirst, linkFindMany, cascadeFindMany, generatedReportCreate, uploadDirect, auditLog }
}

describe('MockRecallReadinessService.computeReadiness', () => {
  it('rejects a platform actor with no company', async () => {
    const { service } = buildHarness()
    await expect(service.computeReadiness(noCompanyActor, RECALL_ID)).rejects.toThrow(ForbiddenException)
  })

  it('404s for a nonexistent recall', async () => {
    const { service, recallFindFirst } = buildHarness()
    recallFindFirst.mockResolvedValueOnce(null)
    await expect(service.computeReadiness(actor, RECALL_ID)).rejects.toThrow(NotFoundException)
  })

  it('refuses to score a real (non-mock) recall', async () => {
    const { service } = buildHarness({ recall: { mode: 'real' } })
    await expect(service.computeReadiness(actor, RECALL_ID)).rejects.toThrow(NotFoundException)
  })

  it('computes 0% across the board with zero stakeholders notified, no crash on empty state', async () => {
    const { service } = buildHarness({ links: [] })
    const result = await service.computeReadiness(actor, RECALL_ID)
    expect(result.acknowledgedWithin24hPercent).toBe(0)
    expect(result.stockTracedPercent).toBe(0)
    expect(result.medianTimeToAcknowledgeHours).toBeNull()
    expect(result.totalStakeholdersNotified).toBe(0)
  })

  it('computes acknowledged-within-24h%, stock-traced%, median ack time, and names real gaps', async () => {
    const links = [
      {
        id: 'link-1',
        createdAt: hoursAgo(30),
        stakeholder: { orgName: 'Fast Pharmacy' },
        actions: [
          { action: 'ack', serverTimestamp: hoursAgo(28) }, // acked 2h after link creation
          { action: 'count', serverTimestamp: hoursAgo(27) },
        ],
      },
      {
        id: 'link-2',
        createdAt: hoursAgo(50),
        stakeholder: { orgName: 'Slow Wholesaler' },
        actions: [
          { action: 'ack', serverTimestamp: hoursAgo(1) }, // acked 49h later — outside 24h
        ],
      },
      {
        id: 'link-3',
        createdAt: hoursAgo(10),
        stakeholder: { orgName: 'Silent Clinic' },
        actions: [], // never acknowledged, never counted
      },
    ]
    const { service } = buildHarness({ links, cascadeInvites: [] })
    const result = await service.computeReadiness(actor, RECALL_ID)

    // 1 of 3 acked within 24h.
    expect(result.acknowledgedWithin24hPercent).toBeCloseTo((1 / 3) * 100, 5)
    // 1 of 3 reported a stock count.
    expect(result.stockTracedPercent).toBeCloseTo((1 / 3) * 100, 5)
    // Median of [2h, 49h] (Silent Clinic never acked, excluded from the ack-time set).
    expect(result.medianTimeToAcknowledgeHours).toBeCloseTo(25.5, 0)
    expect(result.gaps).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Silent Clinic has not acknowledged'),
        expect.stringContaining('Slow Wholesaler never reported a stock count'),
        expect.stringContaining('Silent Clinic never reported a stock count'),
      ]),
    )
    expect(result.totalStakeholdersNotified).toBe(3)
  })

  it('counts a complete cascade invite as a received downstream list and flags an awaiting one as a gap', async () => {
    const { service } = buildHarness({
      links: [],
      cascadeInvites: [
        { status: 'complete', stakeholder: { orgName: 'Regional Distributor' } },
        { status: 'awaiting', stakeholder: { orgName: 'Border Town Depot' } },
      ],
    })
    const result = await service.computeReadiness(actor, RECALL_ID)
    expect(result.downstreamListsReceivedCount).toBe(1)
    expect(result.gaps).toEqual(
      expect.arrayContaining([expect.stringContaining('Border Town Depot')]),
    )
  })
})

describe('MockRecallReadinessService.exportForInspectionFile', () => {
  it('uploads a real text export and archives it as a GeneratedReport row', async () => {
    const { service, uploadDirect, generatedReportCreate, auditLog } = buildHarness({ links: [] })

    await service.exportForInspectionFile(actor, RECALL_ID, {})

    expect(uploadDirect).toHaveBeenCalledWith(
      actor,
      'generated_report',
      expect.any(String),
      expect.objectContaining({ mimetype: 'text/plain' }),
      expect.objectContaining({ title: expect.stringContaining('Mock Recall Readiness') }),
      {},
    )
    expect(generatedReportCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reportTypeKey: 'mock_recall_readiness',
          recordType: 'recall',
          recordId: RECALL_ID,
          status: 'final',
        }),
      }),
    )
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'mock_recall_readiness_exported' }),
    )
  })
})
