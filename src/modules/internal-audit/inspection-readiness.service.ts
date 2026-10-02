import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { InspectionReadinessPack, Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { computeTrainingStatus } from '../training/training-record.service'
import { InspectionReadinessPdfService } from './inspection-readiness-pdf.service'

export interface RequestMeta {
  ip?: string
}

export const INSPECTION_READINESS_PACK_RECORD_TYPE = 'inspection_readiness_pack'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Inspection readiness is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

export interface InspectionReadinessRow {
  sectionKey: string
  title: string
  description: string | null
  status: 'ready' | 'needs_attention'
  note: string
  guidelineReference: string | null
  unverified: boolean
}

export interface InspectionReadinessSnapshot {
  overall: 'ready' | 'needs_attention'
  homeCountryName: string
  authorityConfigured: boolean
  rows: InspectionReadinessRow[]
}

type Tx = Prisma.TransactionClient
type SectionResolver = (tx: Tx, companyId: string) => Promise<{ status: 'ready' | 'needs_attention'; note: string }>

/**
 * QualCloud (Phase 13) Stage 9 — "the single most valuable screen in
 * the platform" (Build Priority doc). One resolver per
 * `InspectionChecklistTemplate.mappedRecordType`, each reading the
 * real underlying table live — the exact same discipline
 * `AuditReadinessService`'s own `SYSTEM_RESOLVERS` map already
 * established for VigiCloud, reused here rather than reinvented.
 */
const SECTION_RESOLVERS: Record<string, SectionResolver> = {
  facility_status: async (tx, companyId) => {
    const count = await tx.facility.count({ where: { companyId, isActive: true } })
    return count > 0
      ? { status: 'ready', note: `${count} active facility record(s) on file.` }
      : { status: 'needs_attention', note: 'No active facility is on file yet.' }
  },
  equipment_qualification: async (tx, companyId) => {
    const now = new Date()
    const notReady = await tx.equipment.count({
      where: {
        companyId,
        isActive: true,
        OR: [
          { qualificationStatus: { in: ['not_qualified', 'disqualified', 'requalification_due'] } },
          { calibrationDueAt: { lt: now } },
        ],
      },
    })
    return notReady === 0
      ? { status: 'ready', note: 'Every active equipment record is qualified and in-calibration.' }
      : { status: 'needs_attention', note: `${notReady} equipment record(s) need qualification or are past calibration.` }
  },
  open_critical_deviations: async (tx, companyId) => {
    const count = await tx.deviation.count({
      where: { companyId, severity: 'critical', status: { not: 'closed' } },
    })
    return count === 0
      ? { status: 'ready', note: 'No open critical deviations.' }
      : { status: 'needs_attention', note: `${count} open critical deviation(s).` }
  },
  training_compliance: async (tx, companyId) => {
    const rows = await tx.trainingRecord.findMany({ where: { companyId }, select: { expiryDate: true } })
    const expired = rows.filter((r) => computeTrainingStatus(r.expiryDate) === 'expired').length
    return expired === 0
      ? { status: 'ready', note: `${rows.length} training record(s) on file, none expired.` }
      : { status: 'needs_attention', note: `${expired} training record(s) have expired.` }
  },
  controlled_document_currency: async (tx, companyId) => {
    const now = new Date()
    const overdue = await tx.sop.count({
      where: { companyId, status: 'effective', nextPeriodicReviewDueAt: { lt: now } },
    })
    return overdue === 0
      ? { status: 'ready', note: 'No effective controlled document is overdue for periodic review.' }
      : { status: 'needs_attention', note: `${overdue} controlled document(s) are overdue for periodic review.` }
  },
  oos_backlog: async (tx, companyId) => {
    const open = await tx.oos.count({ where: { companyId, status: { not: 'closed' } } })
    return open === 0
      ? { status: 'ready', note: 'No open OOS/OOT investigations.' }
      : { status: 'needs_attention', note: `${open} open OOS/OOT investigation(s).` }
  },
  batch_quality_status: async (tx, companyId) => {
    const rejected = await tx.batch.count({ where: { companyId, qualityStatus: 'rejected' } })
    return rejected === 0
      ? { status: 'ready', note: 'No batch currently carries a rejected quality status.' }
      : { status: 'needs_attention', note: `${rejected} batch(es) carry a rejected quality status.` }
  },
  // eslint-disable-next-line @typescript-eslint/require-await -- matches the shared `SectionResolver` signature every other resolver in this map uses, even though this one needs no DB read.
  batch_traceability: async () => ({
    status: 'ready',
    note: "Every batch's genealogy is resolvable via Master Data → Batches (structural capability, always available).",
  }),
}

@Injectable()
export class InspectionReadinessService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly pdfService: InspectionReadinessPdfService,
    private readonly documentsService: DocumentsService,
  ) {}

  async getSnapshot(actor: AuthenticatedUser): Promise<InspectionReadinessSnapshot> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { homeCountryId: true, homeCountry: { select: { name: true } } },
      })
      const templates = await tx.inspectionChecklistTemplate.findMany({
        where: { active: true, authority: { countryId: company.homeCountryId } },
        orderBy: { sortOrder: 'asc' },
      })
      const authorityConfigured =
        (await tx.regulatoryAuthority.count({ where: { countryId: company.homeCountryId } })) > 0

      const rows: InspectionReadinessRow[] = []
      for (const template of templates) {
        const resolver = template.mappedRecordType ? SECTION_RESOLVERS[template.mappedRecordType] : undefined
        const resolved = resolver
          ? await resolver(tx, companyId)
          : { status: 'needs_attention' as const, note: 'No live resolver configured for this section yet.' }
        rows.push({
          sectionKey: template.sectionKey,
          title: template.title,
          description: template.description,
          status: resolved.status,
          note: resolved.note,
          guidelineReference: template.guidelineReference,
          unverified: template.unverified,
        })
      }

      return {
        overall: rows.every((r) => r.status === 'ready') ? 'ready' : 'needs_attention',
        homeCountryName: company.homeCountry.name,
        authorityConfigured,
        rows,
      }
    })
  }

  async generatePack(actor: AuthenticatedUser, meta: RequestMeta): Promise<InspectionReadinessPack> {
    const companyId = requireCompany(actor)

    const company = await this.rls.runAsCompany(companyId, (tx) =>
      tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } }),
    )
    const snapshot = await this.getSnapshot(actor)
    const generatedAt = new Date()

    const pdf = await this.pdfService.render({ companyName: company.name, generatedAt, snapshot })

    const packId = newId()
    const pdfFile: DirectUploadFile = {
      buffer: pdf,
      originalname: `inspection-readiness-pack-${generatedAt.toISOString().slice(0, 10)}.pdf`,
      mimetype: 'application/pdf',
    }
    const pdfUpload = await this.documentsService.uploadDirect(
      actor,
      INSPECTION_READINESS_PACK_RECORD_TYPE,
      packId,
      pdfFile,
      { title: 'Inspection Readiness Pack' },
      meta,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.inspectionReadinessPack.create({
        data: {
          id: packId,
          companyId,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          pdfDocumentId: pdfUpload.document.id,
          generatedBy: actor.sub,
          generatedAt,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'inspection_readiness_pack_generated',
        recordType: INSPECTION_READINESS_PACK_RECORD_TYPE,
        recordId: created.id,
        newValue: { overall: snapshot.overall },
        ip: meta.ip,
      })

      return created
    })
  }

  async listPacks(actor: AuthenticatedUser): Promise<InspectionReadinessPack[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.inspectionReadinessPack.findMany({ where: { companyId }, orderBy: { generatedAt: 'desc' } }),
    )
  }

  async getPack(actor: AuthenticatedUser, id: string): Promise<InspectionReadinessPack> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.inspectionReadinessPack.findFirst({ where: { id, companyId } })
      if (!found) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Inspection readiness pack not found' })
      }
      return found
    })
  }
}
