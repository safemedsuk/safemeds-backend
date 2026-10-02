import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, RecallCascadeInvite, RecallDistributionRecord, RecallImportJob } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { parseCsv } from '../bulk-import/csv.util'
import { CreateRecallDistributionRecordDto } from './dto/create-recall-distribution-record.dto'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Recall distribution data is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

interface ImportRowError {
  row: number
  message: string
}

/**
 * QualCloud (Phase 13) Stage 10.3 — the downstream distribution graph
 * (`RecallDistributionRecord`), its CSV import path (`RecallImportJob`,
 * the Engineering Build Package's own §7 contract:
 * `toOrgName, batchNumber, qtyUnits, qtyPacks, date, invoiceNo`), and
 * the cascade-invite tracker (`RecallCascadeInvite`) — kept in one
 * service since an import always creates distribution records and a
 * cascade invite always targets a distribution record's own
 * recipient, matching this codebase's own precedent for grouping
 * tightly-coupled child concerns (`PvCaseService`'s own
 * `SourceDocumentService` pairing).
 */
@Injectable()
export class RecallDistributionService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async list(actor: AuthenticatedUser, recallId: string): Promise<RecallDistributionRecord[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.recallDistributionRecord.findMany({
        where: { companyId, recallId },
        orderBy: { date: 'desc' },
      }),
    )
  }

  async createRecord(
    actor: AuthenticatedUser,
    recallId: string,
    dto: CreateRecallDistributionRecordDto,
    meta: RequestMeta,
  ): Promise<RecallDistributionRecord> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const recall = await tx.recall.findFirst({ where: { id: recallId, companyId } })
      if (!recall) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall not found' })

      const toOrg = await tx.stakeholder.findFirst({ where: { id: dto.toOrgId, companyId } })
      if (!toOrg) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recipient stakeholder not found' })

      // Real-world stock splits/repacks happen — a downstream quantity
      // exceeding what the parent stakeholder itself received is a
      // warning, never a hard block (10.3's own explicit instruction).
      let warning: string | null = null
      if (dto.fromOrgId) {
        const receivedTotal = await tx.recallDistributionRecord.aggregate({
          where: { companyId, recallId, toOrgId: dto.fromOrgId, batchId: dto.batchId },
          _sum: { qtyUnits: true },
        })
        const sentSoFar = await tx.recallDistributionRecord.aggregate({
          where: { companyId, recallId, fromOrgId: dto.fromOrgId, batchId: dto.batchId },
          _sum: { qtyUnits: true },
        })
        const received = receivedTotal._sum.qtyUnits ?? 0
        const sent = (sentSoFar._sum.qtyUnits ?? 0) + dto.qtyUnits
        if (received > 0 && sent > received) {
          warning = `Cumulative downstream quantity (${sent}) exceeds what this organisation itself received (${received})`
        }
      }

      const created = await tx.recallDistributionRecord.create({
        data: {
          id: newId(),
          companyId,
          recallId,
          batchId: dto.batchId,
          fromOrgId: dto.fromOrgId ?? null,
          toOrgId: dto.toOrgId,
          qtyPacks: dto.qtyPacks ?? null,
          qtyUnits: dto.qtyUnits,
          date: new Date(dto.date),
          source: 'manual',
          sourceRef: dto.sourceRef ?? null,
        },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_distribution_record_created',
        recordType: 'recall_distribution_record',
        recordId: created.id,
        newValue: { toOrgId: dto.toOrgId, qtyUnits: dto.qtyUnits, warning },
        ip: meta.ip,
      })
      return { ...created, warning }
    })
  }

  /**
   * Per-row validation per the build spec's exact contract: batch must
   * be in the recall's own frozen scope, quantity ≥ 0, duplicate
   * detection on `(recipient, batch, invoiceNo)`. Valid rows commit
   * immediately; error rows are reported so they can be fixed and
   * re-imported — never an all-or-nothing rollback of the whole file.
   */
  async importCsv(
    actor: AuthenticatedUser,
    recallId: string,
    csvText: string,
    meta: RequestMeta,
  ): Promise<RecallImportJob> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const recall = await tx.recall.findFirst({ where: { id: recallId, companyId } })
      if (!recall) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall not found' })

      const frozenScope = await tx.recallScopeVersion.findFirst({
        where: { recallId, status: 'frozen' },
        include: { items: { include: { batch: true } } },
        orderBy: { version: 'desc' },
      })
      const scopedBatchByNumber = new Map(
        (frozenScope?.items ?? []).map((item) => [item.batch.batchNumber.toLowerCase(), item.batchId]),
      )

      const rows = parseCsv(csvText)
      const [header, ...dataRows] = rows
      const colIndex = (name: string) => header?.findIndex((h) => h.trim().toLowerCase() === name) ?? -1
      const iOrg = colIndex('toorgname')
      const iBatch = colIndex('batchnumber')
      const iQtyUnits = colIndex('qtyunits')
      const iQtyPacks = colIndex('qtypacks')
      const iDate = colIndex('date')
      const iInvoice = colIndex('invoiceno')

      const errors: ImportRowError[] = []
      let validRows = 0
      const seenKeys = new Set<string>()

      for (let r = 0; r < dataRows.length; r++) {
        const row = dataRows[r]
        if (row.length === 0 || (row.length === 1 && row[0] === '')) continue
        const rowNum = r + 2 // 1-indexed + header row

        const orgName = iOrg >= 0 ? row[iOrg]?.trim() : undefined
        const batchNumber = iBatch >= 0 ? row[iBatch]?.trim() : undefined
        const qtyUnits = iQtyUnits >= 0 ? Number(row[iQtyUnits]) : NaN
        const invoiceNo = iInvoice >= 0 ? row[iInvoice]?.trim() : undefined

        if (!orgName) {
          errors.push({ row: rowNum, message: 'Missing recipient organisation name' })
          continue
        }
        if (!batchNumber || !scopedBatchByNumber.has(batchNumber.toLowerCase())) {
          errors.push({ row: rowNum, message: `Batch "${batchNumber ?? ''}" is not in this recall's frozen scope` })
          continue
        }
        if (!Number.isFinite(qtyUnits) || qtyUnits < 0) {
          errors.push({ row: rowNum, message: 'Quantity (units) must be a number ≥ 0' })
          continue
        }
        const dedupeKey = `${orgName.toLowerCase()}|${batchNumber.toLowerCase()}|${invoiceNo ?? ''}`
        if (seenKeys.has(dedupeKey)) {
          errors.push({ row: rowNum, message: 'Duplicate row (same recipient/batch/invoice already imported)' })
          continue
        }
        seenKeys.add(dedupeKey)

        let toOrg = await tx.stakeholder.findFirst({
          where: { companyId, orgName: { equals: orgName, mode: 'insensitive' } },
        })
        if (!toOrg) {
          toOrg = await tx.stakeholder.create({
            data: { id: newId(), companyId, orgName, type: 'other', createdBy: actor.sub },
          })
        }

        validRows += 1
      }

      const importJob = await tx.recallImportJob.create({
        data: {
          id: newId(),
          companyId,
          recallId,
          rows: dataRows.length,
          validRows,
          errorRows: errors.length,
          status: errors.length > 0 ? 'completed_with_errors' : 'completed',
          mapping: { toOrgName: iOrg, batchNumber: iBatch, qtyUnits: iQtyUnits, qtyPacks: iQtyPacks, date: iDate, invoiceNo: iInvoice },
          errors: errors.length > 0 ? (errors as unknown as Prisma.InputJsonValue) : undefined,
          createdBy: actor.sub,
        },
      })

      // A second pass actually commits the valid rows against the real
      // import job id, now that we know it — kept as a second loop
      // rather than complicating the validation loop above with a
      // not-yet-existing FK.
      for (let r = 0; r < dataRows.length; r++) {
        const row = dataRows[r]
        if (row.length === 0 || (row.length === 1 && row[0] === '')) continue
        const orgName = iOrg >= 0 ? row[iOrg]?.trim() : undefined
        const batchNumber = iBatch >= 0 ? row[iBatch]?.trim() : undefined
        const qtyUnits = iQtyUnits >= 0 ? Number(row[iQtyUnits]) : NaN
        if (!orgName || !batchNumber || !scopedBatchByNumber.has(batchNumber.toLowerCase())) continue
        if (!Number.isFinite(qtyUnits) || qtyUnits < 0) continue

        const toOrg = await tx.stakeholder.findFirst({
          where: { companyId, orgName: { equals: orgName, mode: 'insensitive' } },
        })
        if (!toOrg) continue

        const invoiceNo = iInvoice >= 0 ? row[iInvoice]?.trim() : undefined
        const qtyPacks = iQtyPacks >= 0 ? Number(row[iQtyPacks]) : undefined
        const dateStr = iDate >= 0 ? row[iDate]?.trim() : undefined
        const parsedDate = dateStr ? new Date(dateStr) : new Date()

        await tx.recallDistributionRecord.create({
          data: {
            id: newId(),
            companyId,
            recallId,
            batchId: scopedBatchByNumber.get(batchNumber.toLowerCase())!,
            toOrgId: toOrg.id,
            qtyUnits: Math.trunc(qtyUnits),
            qtyPacks: qtyPacks !== undefined && Number.isFinite(qtyPacks) ? Math.trunc(qtyPacks) : null,
            date: Number.isFinite(parsedDate.getTime()) ? parsedDate : new Date(),
            source: 'import',
            sourceRef: invoiceNo ?? null,
            importJobId: importJob.id,
          },
        })
      }

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_distribution_imported',
        recordType: 'recall_import_job',
        recordId: importJob.id,
        newValue: { rows: dataRows.length, validRows, errorRows: errors.length },
        ip: meta.ip,
      })

      return importJob
    })
  }

  async listImportJobs(actor: AuthenticatedUser, recallId: string): Promise<RecallImportJob[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.recallImportJob.findMany({ where: { companyId, recallId }, orderBy: { createdAt: 'desc' } }),
    )
  }

  async inviteToCascade(
    actor: AuthenticatedUser,
    recallId: string,
    stakeholderId: string,
    meta: RequestMeta,
  ): Promise<RecallCascadeInvite> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const stakeholder = await tx.stakeholder.findFirst({ where: { id: stakeholderId, companyId } })
      if (!stakeholder) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Stakeholder not found' })

      const existing = await tx.recallCascadeInvite.findUnique({
        where: { recallId_stakeholderId: { recallId, stakeholderId } },
      })
      if (existing) return existing

      const created = await tx.recallCascadeInvite.create({
        data: { id: newId(), companyId, recallId, stakeholderId, status: 'awaiting' },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_cascade_invite_created',
        recordType: 'recall_cascade_invite',
        recordId: created.id,
        newValue: { stakeholderId },
        ip: meta.ip,
      })
      return created
    })
  }

  async listCascadeInvites(actor: AuthenticatedUser, recallId: string): Promise<RecallCascadeInvite[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.recallCascadeInvite.findMany({ where: { companyId, recallId }, orderBy: { invitedAt: 'desc' } }),
    )
  }
}
