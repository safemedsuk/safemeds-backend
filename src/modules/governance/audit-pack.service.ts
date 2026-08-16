import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditPack, Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { AuditPackPdfService } from './audit-pack-pdf.service'
import { AuditReadinessService } from './audit-readiness.service'

export interface RequestMeta {
  ip?: string
}

export const AUDIT_PACK_RECORD_TYPE = 'audit_pack'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Audit packs are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * VigiCloud Stage 16.2 — "supports no-notice audits and signal-based
 * spot-checks, so this must be generatable on demand with zero prep
 * time" (Final doc). Mirrors `RegulatorySubmissionService.generate()`'s
 * own transaction shape exactly: slow work (dashboard resolution across
 * many tables, PDF rendering, the R2 upload) happens outside any open
 * Postgres transaction, and only the final row creation is a short,
 * fast, atomic DB write — see that service's own doc comment for why
 * (never hold a transaction open across slow I/O).
 */
@Injectable()
export class AuditPackService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly auditReadinessService: AuditReadinessService,
    private readonly pdfService: AuditPackPdfService,
    private readonly documentsService: DocumentsService,
  ) {}

  async generate(actor: AuthenticatedUser, meta: RequestMeta): Promise<AuditPack> {
    const companyId = requireCompany(actor)

    const company = await this.rls.runAsCompany(companyId, (tx) =>
      tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } }),
    )
    const dashboard = await this.auditReadinessService.getDashboard(actor)
    const generatedAt = new Date()

    const pdf = await this.pdfService.render({ companyName: company.name, generatedAt, dashboard })

    const packId = newId()
    const pdfFile: DirectUploadFile = {
      buffer: pdf,
      originalname: `audit-pack-${generatedAt.toISOString().slice(0, 10)}.pdf`,
      mimetype: 'application/pdf',
    }
    const pdfUpload = await this.documentsService.uploadDirect(
      actor,
      AUDIT_PACK_RECORD_TYPE,
      packId,
      pdfFile,
      { title: 'Audit Pack Cover Sheet' },
      meta,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.auditPack.create({
        data: {
          id: packId,
          companyId,
          snapshot: dashboard as unknown as Prisma.InputJsonValue,
          pdfDocumentId: pdfUpload.document.id,
          generatedBy: actor.sub,
          generatedAt,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'audit_pack_generated',
        recordType: AUDIT_PACK_RECORD_TYPE,
        recordId: created.id,
        newValue: {
          overall: dashboard.overall,
          readyCount: dashboard.readyCount,
          totalMandatory: dashboard.totalMandatory,
        },
        ip: meta.ip,
      })

      return created
    })
  }

  async list(actor: AuthenticatedUser): Promise<AuditPack[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.auditPack.findMany({ where: { companyId }, orderBy: { generatedAt: 'desc' } }),
    )
  }

  async get(actor: AuthenticatedUser, id: string): Promise<AuditPack> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.auditPack.findFirst({ where: { id, companyId } })
      if (!found) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Audit pack not found' })
      }
      return found
    })
  }
}
