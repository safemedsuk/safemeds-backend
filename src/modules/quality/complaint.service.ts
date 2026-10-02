import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Complaint, DrugCharacterization, Prisma, ReporterType } from '@prisma/client'

import { TextEncryptionService } from '../../common/encryption/text-encryption.service'
import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CapaService } from '../internal-audit/capa.service'
import { resolveDefaultReportType } from '../pv/default-report-type.util'
import { PvCaseService } from '../pv/pv-case.service'
import { WorkflowService } from '../workflow/workflow.service'
import { ClassifyComplaintDto } from './dto/classify-complaint.dto'
import { CreateComplaintDto, PublicCreateComplaintDto } from './dto/create-complaint.dto'
import { ListComplaintsQueryDto } from './dto/list-complaints-query.dto'
import { OpenCapaForComplaintDto } from './dto/open-capa-for-complaint.dto'
import { ResolveComplaintDto } from './dto/resolve-complaint.dto'

export interface RequestMeta {
  ip?: string
}

export const QUALITY_COMPLAINT_RECORD_TYPE = 'quality_complaint'

type DecryptedComplaint = Omit<Complaint, 'descriptionEncrypted' | 'resolutionNoteEncrypted'> & {
  description: string
  resolutionNote: string | null
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Complaints are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

async function nextComplaintNumber(tx: Prisma.TransactionClient, companyId: string): Promise<string> {
  const year = new Date().getUTCFullYear()
  const count = await tx.complaint.count({
    where: { companyId, complaintNumber: { startsWith: `CMP-${year}-` } },
  })
  return `CMP-${year}-${String(count + 1).padStart(5, '0')}`
}

/**
 * QualCloud (Phase 13) Stage 5 — Complaint Handling. Its own supporting
 * workflow: Intake → Classify → Investigate → Resolve. `classify()` is
 * the single most important method: when `dto.classification ===
 * 'possible_ae'`, it routes this complaint to VigiCloud as a **real PV
 * case** via the already-existing `PvCaseService.createFromSystemChannel()`
 * — the same mechanism every other reporter-blind intake channel (public
 * URL, email, WhatsApp) already uses, with `channel:
 * 'quality_complaint_routed'`. Deliberately two sequential, top-level
 * calls, not one nested transaction: the workflow `transition()` call
 * commits first (it manages its own transaction), *then* the PV case is
 * created as a separate call — `createFromSystemChannel()` opens its own
 * transaction internally too, so nesting either call inside the other's
 * transaction would risk the same nested-transaction problem this
 * codebase's own "do the slow/cross-service part outside the guard's
 * transaction" discipline already warns against (see
 * `ChangeControlService.openLinkedVariation()`'s identical reasoning).
 */
@Injectable()
export class ComplaintService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly workflowService: WorkflowService,
    private readonly textEncryption: TextEncryptionService,
    private readonly capaService: CapaService,
    private readonly pvCaseService: PvCaseService,
  ) {}

  private decrypt(row: Complaint): DecryptedComplaint {
    const { descriptionEncrypted, resolutionNoteEncrypted, ...rest } = row
    return {
      ...rest,
      description: this.textEncryption.decrypt(descriptionEncrypted),
      resolutionNote: resolutionNoteEncrypted
        ? this.textEncryption.decrypt(resolutionNoteEncrypted)
        : null,
    }
  }

  async list(
    actor: AuthenticatedUser,
    query: ListComplaintsQueryDto,
  ): Promise<PaginatedResult<DecryptedComplaint>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.ComplaintWhereInput = {
        companyId,
        ...(query.q
          ? {
              OR: [{ complaintNumber: { contains: query.q, mode: 'insensitive' } }],
            }
          : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.classification ? { classification: query.classification } : {}),
        ...(query.productId ? { productId: query.productId } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.complaint.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.complaint.count({ where }),
      ])
      return paginate(
        rows.map((r) => this.decrypt(r)),
        total,
        query,
      )
    })
  }

  /** The live resolution-time KPI — never cached, matching this codebase's own "quality metrics are always live-computed" discipline. */
  async resolutionTimeKpi(
    actor: AuthenticatedUser,
  ): Promise<{ averageDays: number | null; withinTargetPercent: number | null; targetDays: number; resolvedCount: number }> {
    const companyId = requireCompany(actor)
    const targetDays = 30
    return this.rls.runAsCompany(companyId, async (tx) => {
      const resolved = await tx.complaint.findMany({
        where: { companyId, resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true },
      })
      if (resolved.length === 0) {
        return { averageDays: null, withinTargetPercent: null, targetDays, resolvedCount: 0 }
      }
      const daysFor = (c: { createdAt: Date; resolvedAt: Date | null }) =>
        (c.resolvedAt!.getTime() - c.createdAt.getTime()) / (24 * 60 * 60 * 1000)
      const days = resolved.map(daysFor)
      const averageDays = days.reduce((a, b) => a + b, 0) / days.length
      const withinTarget = days.filter((d) => d <= targetDays).length
      return {
        averageDays: Math.round(averageDays * 10) / 10,
        withinTargetPercent: Math.round((withinTarget / days.length) * 1000) / 10,
        targetDays,
        resolvedCount: resolved.length,
      }
    })
  }

  async get(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<DecryptedComplaint & { workflowInstanceId: string | null }> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.complaint.findFirst({ where: { id, companyId } })
      if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Complaint not found' })
      const workflowInstance = await tx.workflowInstance.findFirst({
        where: { recordType: QUALITY_COMPLAINT_RECORD_TYPE, recordId: id },
      })
      return { ...this.decrypt(found), workflowInstanceId: workflowInstance?.id ?? null }
    })
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateComplaintDto,
    meta: RequestMeta,
  ): Promise<DecryptedComplaint> {
    const companyId = requireCompany(actor)
    return this.createInternal(companyId, dto, actor.sub, meta)
  }

  /**
   * The real public-facing intake option, mirroring VigiCloud's own
   * public-reporting-slug precedent — a distributor/retail customer
   * complaint often doesn't come from someone with a SafeMeds login.
   * `PublicComplaintController` resolves the company from the slug and
   * calls this directly with `createdBy: null`.
   */
  async createPublic(
    companyId: string,
    dto: PublicCreateComplaintDto,
    meta: RequestMeta,
  ): Promise<DecryptedComplaint> {
    return this.createInternal(
      companyId,
      {
        productId: dto.productId,
        batchId: dto.batchId,
        reporterName: dto.reporterName,
        reporterContact: dto.reporterEmail ?? dto.reporterPhone,
        channel: 'distributor',
        description: dto.description,
      },
      null,
      meta,
    )
  }

  private async createInternal(
    companyId: string,
    dto: CreateComplaintDto,
    createdBy: string | null,
    meta: RequestMeta,
  ): Promise<DecryptedComplaint> {
    return this.rls.runAsCompany(companyId, async (tx) => {
      const complaintNumber = await nextComplaintNumber(tx, companyId)

      const created = await tx.complaint.create({
        data: {
          id: newId(),
          companyId,
          complaintNumber,
          productId: dto.productId,
          batchId: dto.batchId ?? null,
          reporterName: dto.reporterName ?? null,
          reporterContact: dto.reporterContact ?? null,
          channel: dto.channel,
          descriptionEncrypted: this.textEncryption.encrypt(dto.description),
          status: 'intake',
          createdBy,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: createdBy,
        companyId,
        action: 'complaint_created',
        recordType: QUALITY_COMPLAINT_RECORD_TYPE,
        recordId: created.id,
        newValue: { complaintNumber: created.complaintNumber },
        ip: meta.ip,
      })

      await this.workflowService.instantiate(
        { companyId, sub: createdBy ?? undefined },
        QUALITY_COMPLAINT_RECORD_TYPE,
        created.id,
        null,
        meta,
      )

      return this.decrypt(created)
    })
  }

  async classify(
    actor: AuthenticatedUser,
    id: string,
    dto: ClassifyComplaintDto,
    meta: RequestMeta,
  ): Promise<DecryptedComplaint> {
    const companyId = requireCompany(actor)

    const complaint = await this.rls.runAsCompany(companyId, (tx) =>
      tx.complaint.findFirst({ where: { id, companyId } }),
    )
    if (!complaint) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Complaint not found' })

    const instance = await this.rls.runAsCompany(companyId, (tx) =>
      tx.workflowInstance.findFirstOrThrow({
        where: { recordType: QUALITY_COMPLAINT_RECORD_TYPE, recordId: id },
      }),
    )

    await this.workflowService.transition(
      actor,
      instance.id,
      'classifying',
      { note: dto.note },
      meta,
    )

    const withClassification = await this.rls.runAsCompany(companyId, async (tx) => {
      const updated = await tx.complaint.update({
        where: { id },
        data: {
          classification: dto.classification,
          severity: dto.classification === 'quality_complaint' ? dto.severity ?? null : null,
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'complaint_classified',
        recordType: QUALITY_COMPLAINT_RECORD_TYPE,
        recordId: id,
        newValue: { classification: dto.classification },
        ip: meta.ip,
      })
      return updated
    })

    if (dto.classification !== 'possible_ae' || withClassification.routedCaseId) {
      return this.decrypt(withClassification)
    }

    // Sequential and outside any open transaction, on purpose — see
    // this class's own doc comment.
    const routedCase = await this.routeToPvCase(companyId, withClassification, meta)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const updated = await tx.complaint.update({
        where: { id },
        data: { routedCaseId: routedCase.id },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'complaint_routed_to_pv_case',
        recordType: QUALITY_COMPLAINT_RECORD_TYPE,
        recordId: id,
        newValue: { caseId: routedCase.id, referenceNumber: routedCase.referenceNumber },
        ip: meta.ip,
      })
      return this.decrypt(updated)
    })
  }

  private async routeToPvCase(
    companyId: string,
    complaint: Complaint,
    meta: RequestMeta,
  ): Promise<{ id: string; referenceNumber: string }> {
    const company = await this.rls.runWithSystemAccess((tx) =>
      tx.company.findUniqueOrThrow({ where: { id: companyId } }),
    )
    const product = await this.rls.runAsCompany(companyId, (tx) =>
      tx.product.findUniqueOrThrow({ where: { id: complaint.productId } }),
    )
    const reportType = await this.rls.runWithSystemAccess((tx) => resolveDefaultReportType(tx))
    if (!reportType) {
      throw new ConflictException({
        code: 'NOT_CONFIGURED',
        message: 'No PV report type is configured for this company yet — cannot route this complaint as an adverse event',
      })
    }
    const today = new Date().toISOString().slice(0, 10)
    const description = this.textEncryption.decrypt(complaint.descriptionEncrypted)

    const created = await this.pvCaseService.createFromSystemChannel(
      companyId,
      {
        reportTypeId: reportType.id,
        countryOfOccurrenceId: company.homeCountryId,
        countryOfReportId: company.homeCountryId,
        awarenessDate: today,
        receivedDate: today,
        additionalInformation: `Routed from quality complaint ${complaint.complaintNumber}.`,
        reporter: {
          reporterType: ReporterType.consumer,
          fullName: complaint.reporterName ?? undefined,
          email: complaint.reporterContact?.includes('@') ? complaint.reporterContact : undefined,
          phone: !complaint.reporterContact?.includes('@') ? complaint.reporterContact ?? undefined : undefined,
        },
        patient: {},
        suspectProducts: [
          {
            drugCharacterization: DrugCharacterization.suspect,
            medicinalProduct: product.brandName,
            productId: product.id,
          },
        ],
        adverseEvents: [
          {
            reportedTerm: `Possible adverse event reported via quality complaint ${complaint.complaintNumber}`,
            narrative: description,
          },
        ],
      },
      'quality_complaint_routed',
      complaint.id,
      meta,
    )

    return { id: created.id, referenceNumber: created.referenceNumber }
  }

  async resolve(
    actor: AuthenticatedUser,
    id: string,
    dto: ResolveComplaintDto,
    meta: RequestMeta,
  ): Promise<DecryptedComplaint> {
    const companyId = requireCompany(actor)
    const instance = await this.rls.runAsCompany(companyId, (tx) =>
      tx.workflowInstance.findFirstOrThrow({
        where: { recordType: QUALITY_COMPLAINT_RECORD_TYPE, recordId: id },
      }),
    )
    await this.workflowService.transition(actor, instance.id, 'resolved', {}, meta)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const updated = await tx.complaint.update({
        where: { id, companyId },
        data: {
          resolutionNoteEncrypted: this.textEncryption.encrypt(dto.resolutionNote),
          resolvedAt: new Date(),
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'complaint_resolved',
        recordType: QUALITY_COMPLAINT_RECORD_TYPE,
        recordId: id,
        newValue: {},
        ip: meta.ip,
      })
      return this.decrypt(updated)
    })
  }

  /** Not every complaint needs a CAPA — a confirmed one-off packaging defect might just need a correction; this stays optional, unlike Deviation's own mandatory-CAPA-to-close guard. */
  async openCapaForComplaint(
    actor: AuthenticatedUser,
    complaintId: string,
    dto: OpenCapaForComplaintDto,
    meta: RequestMeta,
  ) {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const complaint = await tx.complaint.findFirst({ where: { id: complaintId, companyId } })
      if (!complaint)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Complaint not found' })

      return this.capaService.createFrom(
        tx,
        actor,
        companyId,
        'complaint',
        complaintId,
        {
          title: dto.title,
          correctiveAction: dto.correctiveAction,
          preventiveAction: dto.preventiveAction,
          rootCauseCategory: dto.rootCauseCategory,
          ownerUserId: dto.ownerUserId,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        },
        meta,
      )
    })
  }
}
