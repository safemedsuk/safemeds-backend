import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { GeneratedReport } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { RECALL_RECORD_TYPE } from './recall.service'
import { RECALL_INVESTIGATION_CAPA_SOURCE_TYPE } from './recall-closure-gate.service'
import { RecallCompliancePackData, RecallCompliancePackPdfService } from './recall-compliance-pack-pdf.service'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A recall compliance pack is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

export const RECALL_COMPLIANCE_PACK_REPORT_TYPE_KEY = 'recall_compliance_pack'

/**
 * QualCloud (Phase 13) Stage 10.6 — "the compliance pack reuses
 * `GeneratedReport` exactly as every other QualCloud/RegCloud/VigiCloud
 * audit-pack-shaped output already does (Reconciliation Note 10) —
 * generated from a point-in-time snapshot, stored as its own hashed
 * evidence row, never regenerated-in-place." Every `generate()` call
 * therefore creates a brand-new `GeneratedReport` row, never updates
 * an existing one — the archive grows, matching every other periodic-
 * document precedent in this codebase. The slow work (assembling data
 * across a dozen services, rendering the PDF, uploading to R2) all
 * happens outside any open Postgres transaction, per this codebase's
 * own established "never hold a transaction open across slow I/O"
 * discipline.
 */
@Injectable()
export class RecallCompliancePackService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
    private readonly pdfService: RecallCompliancePackPdfService,
  ) {}

  async list(actor: AuthenticatedUser, recallId: string): Promise<GeneratedReport[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.generatedReport.findMany({
        where: {
          companyId,
          reportTypeKey: RECALL_COMPLIANCE_PACK_REPORT_TYPE_KEY,
          recordType: RECALL_RECORD_TYPE,
          recordId: recallId,
        },
        orderBy: { createdAt: 'desc' },
      }),
    )
  }

  async generate(actor: AuthenticatedUser, recallId: string, meta: RequestMeta): Promise<GeneratedReport> {
    const companyId = requireCompany(actor)

    const data = await this.assemble(companyId, recallId)
    data.transitionHistory = await this.loadTransitionHistory(actor, recallId)

    const pdf = await this.pdfService.render(data)
    const reportId = newId()
    const pdfFile: DirectUploadFile = {
      buffer: pdf,
      originalname: `recall-compliance-pack-${data.recallRef}-${new Date().toISOString().slice(0, 10)}.pdf`,
      mimetype: 'application/pdf',
    }
    // Same `(recordType: 'generated_report', recordId: <this report's
    // own id, minted up front>)` pattern `PeriodicReportService` already
    // established — `GeneratedReport` itself carries no direct
    // document-id column; the PDF is discoverable via the generic
    // Documents panel against the report row's own id.
    await this.documentsService.uploadDirect(
      actor,
      'generated_report',
      reportId,
      pdfFile,
      { title: `Recall Compliance Pack — ${data.recallRef}` },
      meta,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.generatedReport.create({
        data: {
          id: reportId,
          companyId,
          moduleKey: 'qualcloud',
          reportTypeKey: RECALL_COMPLIANCE_PACK_REPORT_TYPE_KEY,
          title: `Recall Compliance Pack — ${data.recallRef}`,
          recordType: RECALL_RECORD_TYPE,
          recordId: recallId,
          status: 'final',
          generatedBy: actor.sub,
        },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_compliance_pack_generated',
        recordType: RECALL_RECORD_TYPE,
        recordId: recallId,
        newValue: { generatedReportId: created.id },
        ip: meta.ip,
      })
      return created
    })
  }

  /** Mirrors `RecallService.get()`'s own `transitionHistory` resolution exactly — `AuditService.query()` needs a real actor, not just a `tx`, so this can't live inside `assemble()`'s own `runAsCompany` call. */
  private async loadTransitionHistory(
    actor: AuthenticatedUser,
    recallId: string,
  ): Promise<RecallCompliancePackData['transitionHistory']> {
    const historyPage = await this.auditService.query(actor, {
      recordType: RECALL_RECORD_TYPE,
      recordId: recallId,
      action: 'state_change',
      page: 1,
      limit: 200,
    })
    return historyPage.data.map((entry) => {
      const oldValue = entry.oldValue as { stateKey?: string } | null
      const newValue = entry.newValue as { stateKey?: string } | null
      return {
        fromStateKey: oldValue?.stateKey ?? null,
        toStateKey: newValue?.stateKey ?? '',
        occurredAt: entry.occurredAt,
        actorName: entry.actorName,
      }
    })
  }

  private async assemble(companyId: string, recallId: string): Promise<RecallCompliancePackData> {
    return this.rls.runAsCompany(companyId, async (tx) => {
      const recall = await tx.recall.findFirst({
        where: { id: recallId, companyId },
        include: { product: { select: { brandName: true } } },
      })
      if (!recall) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall not found' })

      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } })

      const countries = await tx.recallCountry.findMany({
        where: { companyId, recallId },
        include: { country: { select: { name: true } }, ruleSet: true },
      })
      const countryIds = countries.map((c) => c.id)

      const [
        riskAssessment,
        scopeVersions,
        distributionRecords,
        stakeholders,
        cascadeInvites,
        messages,
        quarantineRecords,
        returnRecords,
        reconciliationSnapshots,
        discrepancies,
        destructionRecords,
        effectivenessChecks,
        submissions,
        investigationCapa,
        evidenceCount,
        rules,
      ] = await Promise.all([
        tx.riskAssessment.findFirst({ where: { companyId, sourceRecordType: 'recall', sourceRecordId: recallId } }),
        tx.recallScopeVersion.findFirst({
          where: { companyId, recallId, status: 'frozen' },
          include: { items: true },
          orderBy: { version: 'desc' },
        }),
        tx.recallDistributionRecord.findMany({
          where: { companyId, recallId },
          include: { batch: { select: { batchNumber: true } }, toOrg: { select: { orgName: true } } },
          orderBy: { date: 'desc' },
          take: 100,
        }),
        tx.stakeholder.findMany({ where: { companyId } , take: 100 }),
        tx.recallCascadeInvite.findMany({
          where: { companyId, recallId },
          include: { stakeholder: { select: { orgName: true } } },
        }),
        tx.recallMessage.findMany({ where: { companyId, recallId } }),
        tx.recallQuarantineRecord.findMany({
          where: { companyId, recallId },
          include: { batch: { select: { batchNumber: true } } },
        }),
        tx.recallReturnRecord.findMany({ where: { companyId, recallId } }),
        countryIds.length > 0
          ? tx.recallReconciliationSnapshot.findMany({
              where: { companyId, recallCountryId: { in: countryIds } },
              orderBy: { calculatedAt: 'desc' },
            })
          : Promise.resolve([]),
        tx.recallDiscrepancy.findMany({ where: { companyId, recallId } }),
        countryIds.length > 0
          ? tx.recallDestructionRecord.findMany({ where: { companyId, recallCountryId: { in: countryIds } } })
          : Promise.resolve([]),
        countryIds.length > 0
          ? tx.recallEffectivenessCheck.findMany({ where: { companyId, recallCountryId: { in: countryIds } } })
          : Promise.resolve([]),
        countryIds.length > 0
          ? tx.recallSubmission.findMany({
              where: { companyId, recallCountryId: { in: countryIds } },
              include: { template: { select: { code: true } } },
            })
          : Promise.resolve([]),
        tx.capa.findFirst({
          where: {
            companyId,
            OR: [
              { sourceRecordType: RECALL_INVESTIGATION_CAPA_SOURCE_TYPE, sourceRecordId: recallId },
              ...(recall.rootCauseCapaId ? [{ id: recall.rootCauseCapaId }] : []),
            ],
          },
        }),
        tx.document.count({ where: { companyId, recordType: RECALL_RECORD_TYPE, recordId: recallId } }),
        countryIds.length > 0
          ? tx.recallRule.findMany({
              where: { ruleSetId: { in: countries.map((c) => c.ruleSetId).filter((id): id is string => !!id) } },
              include: { ruleSet: { include: { country: { select: { name: true } } } } },
            })
          : Promise.resolve([]),
      ])

      const workflowInstance = await tx.workflowInstance.findFirst({
        where: { recordType: RECALL_RECORD_TYPE, recordId: recallId },
        include: { currentState: true },
      })

      return {
        companyName: company.name,
        recallRef: recall.ref ?? recall.id,
        productName: recall.product.brandName,
        reason: recall.reason,
        mode: recall.mode,
        type: recall.type,
        level: recall.level,
        status: workflowInstance?.currentState.stateKey ?? recall.status,
        openedAt: recall.openedAt,
        closedAt: recall.closedAt,
        riskAssessment: riskAssessment
          ? {
              title: riskAssessment.title,
              severity: riskAssessment.severity,
              probability: riskAssessment.probability,
              score: riskAssessment.score,
              riskLevel: riskAssessment.riskLevel,
            }
          : null,
        scopeItems: (scopeVersions?.items ?? []).map((i) => ({
          productId: i.productId,
          batchId: i.batchId,
          batchSize: i.batchSize,
        })),
        countries: countries.map((c) => ({
          countryName: c.country.name,
          status: c.status,
          class: c.class,
          level: c.level,
          ruleSetVersion: c.ruleSetVersion,
          regulatorDecision: c.regulatorDecision,
        })),
        rules: rules.map((r) => ({
          countryName: r.ruleSet.country.name,
          code: r.code,
          requirementText: r.requirementText,
          sourceDoc: r.sourceDoc,
          unverified: r.unverified,
          ruleSetStatus: r.ruleSet.status,
        })),
        transitionHistory: [], // filled in by `generate()` after this transaction exits — see `loadTransitionHistory()`
        distribution: distributionRecords.map((d) => ({
          batchNumber: d.batch.batchNumber,
          toOrgName: d.toOrg.orgName,
          qtyUnits: d.qtyUnits,
          date: d.date,
        })),
        stakeholders: stakeholders.map((s) => ({ orgName: s.orgName, type: s.type, country: s.country })),
        cascadeInvites: cascadeInvites.map((c) => ({ stakeholderOrgName: c.stakeholder.orgName, status: c.status })),
        messages: messages.map((m) => ({ channel: m.channel, status: m.status, isDrill: m.isDrill })),
        quarantine: quarantineRecords.map((q) => ({ batchNumber: q.batch.batchNumber, fullPacks: q.fullPacks })),
        returns: returnRecords.map((r) => ({
          ref: r.ref,
          qty: r.qty,
          verdict: r.verdict,
          creditStatus: r.creditStatus,
        })),
        reconciliation: reconciliationSnapshots.map((s) => {
          const country = countries.find((c) => c.id === s.recallCountryId)
          return {
            countryName: country?.country.name ?? 'Unknown',
            distributed: s.distributed,
            recovered: s.recovered,
            quarantined: s.quarantined,
            accounted: s.accounted,
            outstanding: s.outstanding,
            destroyed: s.destroyed,
            calculatedAt: s.calculatedAt,
          }
        }),
        discrepancies: discrepancies.map((d) => ({
          units: d.units,
          reason: d.reason,
          blocking: d.blocking,
          status: d.status,
        })),
        destruction: destructionRecords.map((d) => ({ units: d.units, status: d.status })),
        effectivenessChecks: effectivenessChecks.map((c) => ({
          method: c.method,
          sampleSize: c.sampleSize,
          clear: c.clear,
          stockFound: c.stockFound,
          status: c.status,
        })),
        submissions: submissions.map((s) => {
          const country = countries.find((c) => c.id === s.recallCountryId)
          return {
            countryName: country?.country.name ?? 'Unknown',
            templateCode: s.template.code,
            status: s.status,
            generatedAt: s.generatedAt,
          }
        }),
        investigationCapa: investigationCapa
          ? {
              title: investigationCapa.title,
              correctiveAction: investigationCapa.correctiveAction,
              status: investigationCapa.status,
            }
          : null,
        evidenceCount,
        generatedAt: new Date(),
      }
    })
  }
}
