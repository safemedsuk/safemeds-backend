import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { GeneratedReport } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { RECALL_RECORD_TYPE } from './recall.service'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A mock-recall readiness report is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

export const MOCK_RECALL_READINESS_REPORT_TYPE_KEY = 'mock_recall_readiness'

/** WHO GMP's own commonly-cited annual self-inspection/mock-recall convention — see `Company.mockRecallCadenceMonths`'s own schema doc comment for why this is a generic default, not a confirmed Kenya-PPB requirement. */
export const DEFAULT_MOCK_RECALL_CADENCE_MONTHS = 12

export interface MockRecallReadinessResult {
  recallId: string
  ref: string | null
  acknowledgedWithin24hPercent: number
  medianTimeToAcknowledgeHours: number | null
  stockTracedPercent: number
  downstreamListsReceivedCount: number
  gaps: string[]
  totalStakeholdersNotified: number
}

/**
 * QualCloud (Phase 13) Stage 10.7 — a mock recall (`Recall.mode ===
 * 'mock'`) runs through the exact same workflow/rules-engine/portal/
 * messaging mechanism as a real one (10.0's own "not a separate model"
 * instruction) — this service is the one genuinely new piece: the
 * readiness score/report the Product Build Package's own Mock Recalls
 * screen calls for (acknowledged-within-24h %, median time to
 * acknowledge, stock-traced %, downstream-lists-received count, named
 * gaps), computed live from the real `RecallPortalLink`/
 * `RecallPortalAction`/`RecallCascadeInvite` rows a drill produces —
 * never a separate, parallel drill-tracking table.
 */
@Injectable()
export class MockRecallReadinessService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
  ) {}

  async computeReadiness(actor: AuthenticatedUser, recallId: string): Promise<MockRecallReadinessResult> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const recall = await tx.recall.findFirst({ where: { id: recallId, companyId } })
      if (!recall) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall not found' })
      if (recall.mode !== 'mock') {
        throw new NotFoundException({
          code: 'NOT_A_MOCK_RECALL',
          message: 'Readiness scoring only applies to a mock recall (mode: mock)',
        })
      }

      const links = await tx.recallPortalLink.findMany({
        where: { companyId, recallId },
        include: { stakeholder: { select: { orgName: true } }, actions: true },
      })

      const gaps: string[] = []
      let acknowledgedWithin24h = 0
      let stockTraced = 0
      const ackHours: number[] = []

      for (const link of links) {
        const ackAction = link.actions
          .filter((a) => a.action === 'ack')
          .sort((a, b) => a.serverTimestamp.getTime() - b.serverTimestamp.getTime())[0]
        if (ackAction) {
          const hours = (ackAction.serverTimestamp.getTime() - link.createdAt.getTime()) / (1000 * 60 * 60)
          ackHours.push(hours)
          if (hours <= 24) acknowledgedWithin24h += 1
        } else {
          gaps.push(`${link.stakeholder.orgName} has not acknowledged the drill`)
        }

        const countAction = link.actions.some((a) => a.action === 'count')
        if (countAction) {
          stockTraced += 1
        } else {
          gaps.push(`${link.stakeholder.orgName} never reported a stock count`)
        }
      }

      const cascadeInvites = await tx.recallCascadeInvite.findMany({
        where: { companyId, recallId },
        include: { stakeholder: { select: { orgName: true } } },
      })
      const downstreamListsReceivedCount = cascadeInvites.filter((c) => c.status === 'complete').length
      for (const invite of cascadeInvites.filter((c) => c.status === 'awaiting')) {
        gaps.push(`${invite.stakeholder.orgName}'s own downstream customer list is still awaited`)
      }

      ackHours.sort((a, b) => a - b)
      const median =
        ackHours.length === 0
          ? null
          : ackHours.length % 2 === 1
            ? ackHours[(ackHours.length - 1) / 2]
            : (ackHours[ackHours.length / 2 - 1] + ackHours[ackHours.length / 2]) / 2

      return {
        recallId,
        ref: recall.ref,
        acknowledgedWithin24hPercent: links.length > 0 ? (acknowledgedWithin24h / links.length) * 100 : 0,
        medianTimeToAcknowledgeHours: median,
        stockTracedPercent: links.length > 0 ? (stockTraced / links.length) * 100 : 0,
        downstreamListsReceivedCount,
        gaps,
        totalStakeholdersNotified: links.length,
      }
    })
  }

  /** Exports the readiness result as a real, archived `GeneratedReport` row — "for inspection files," per this stage's own spec. */
  async exportForInspectionFile(
    actor: AuthenticatedUser,
    recallId: string,
    meta: RequestMeta,
  ): Promise<GeneratedReport> {
    const companyId = requireCompany(actor)
    const result = await this.computeReadiness(actor, recallId)

    const reportId = newId()
    const lines = [
      `Mock Recall Readiness Report — ${result.ref ?? recallId}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      `Stakeholders notified: ${result.totalStakeholdersNotified}`,
      `Acknowledged within 24h: ${result.acknowledgedWithin24hPercent.toFixed(1)}%`,
      `Median time to acknowledge: ${result.medianTimeToAcknowledgeHours?.toFixed(1) ?? 'n/a'} hours`,
      `Stock traced: ${result.stockTracedPercent.toFixed(1)}%`,
      `Downstream lists received: ${result.downstreamListsReceivedCount}`,
      '',
      'Gaps:',
      ...(result.gaps.length > 0 ? result.gaps.map((g) => `- ${g}`) : ['(none)']),
    ]
    const file: DirectUploadFile = {
      buffer: Buffer.from(lines.join('\n'), 'utf-8'),
      originalname: `mock-recall-readiness-${result.ref ?? recallId}.txt`,
      mimetype: 'text/plain',
    }
    await this.documentsService.uploadDirect(
      actor,
      'generated_report',
      reportId,
      file,
      { title: `Mock Recall Readiness — ${result.ref ?? recallId}` },
      meta,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.generatedReport.create({
        data: {
          id: reportId,
          companyId,
          moduleKey: 'qualcloud',
          reportTypeKey: MOCK_RECALL_READINESS_REPORT_TYPE_KEY,
          title: `Mock Recall Readiness — ${result.ref ?? recallId}`,
          recordType: RECALL_RECORD_TYPE,
          recordId: recallId,
          status: 'final',
          generatedBy: actor.sub,
        },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'mock_recall_readiness_exported',
        recordType: RECALL_RECORD_TYPE,
        recordId: recallId,
        newValue: { generatedReportId: created.id },
        ip: meta.ip,
      })
      return created
    })
  }
}
