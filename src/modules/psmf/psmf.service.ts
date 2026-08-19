import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, Psmf } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { AttachPsmfDocumentDto } from './dto/attach-psmf-document.dto'
import { CreatePsmfDto } from './dto/create-psmf.dto'
import { UpdatePsmfContentDto } from './dto/update-psmf-content.dto'
import { PsmfContent, PsmfPdfService } from './psmf-pdf.service'

export interface RequestMeta {
  ip?: string
}

export const PSMF_RECORD_TYPE = 'psmf'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A PSMF is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * VigiCloud Stage 16.1 — version-on-write exactly like
 * `CountryConfigService`'s own reporting-rule precedent, but tenant-scoped
 * (RLS via `RlsService.runAsCompany`, not the bare-Prisma pattern that
 * module uses for platform-managed config). `create()` always inserts a
 * new `draft` at `(max version for this company) + 1`. `activate()`
 * retires whatever was previously active and flips the target — enforced
 * by the DB-level partial unique index `psmf_one_active_per_company`
 * this stage's migration added by hand. A draft can exist with no
 * `documentId` at all (GUD/006's own "create it with the client, or let
 * them upload an existing one" onboarding language) — `activate()` is the
 * one place a document becomes mandatory, since an active PSMF with
 * nothing behind it would defeat the entire point of `EntitlementsService`'s
 * new gate (see that service's own doc comment).
 */
@Injectable()
export class PsmfService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly pdfService: PsmfPdfService,
    private readonly documentsService: DocumentsService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreatePsmfDto, meta: RequestMeta): Promise<Psmf> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const latest = await tx.psmf.findFirst({ where: { companyId }, orderBy: { version: 'desc' } })
      const nextVersion = (latest?.version ?? 0) + 1

      const created = await tx.psmf.create({
        data: {
          id: newId(),
          companyId,
          version: nextVersion,
          title: dto.title,
          summary: dto.summary ?? null,
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'psmf_draft_created',
        recordType: PSMF_RECORD_TYPE,
        recordId: created.id,
        newValue: { version: created.version, title: created.title },
        ip: meta.ip,
      })

      return created
    })
  }

  async attachDocument(
    actor: AuthenticatedUser,
    id: string,
    dto: AttachPsmfDocumentDto,
    meta: RequestMeta,
  ): Promise<Psmf> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.psmf.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'PSMF draft not found' })
      }
      if (existing.status !== 'draft') {
        throw new ConflictException({
          code: 'NOT_A_DRAFT',
          message: 'Only a draft PSMF can have its document changed',
        })
      }

      const document = await tx.document.findFirst({
        where: { id: dto.documentId, companyId, recordType: PSMF_RECORD_TYPE, recordId: id },
      })
      if (!document) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message:
            'Document not found for this PSMF — upload it first via the generic documents endpoint',
        })
      }

      const updated = await tx.psmf.update({ where: { id }, data: { documentId: dto.documentId } })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'psmf_document_attached',
        recordType: PSMF_RECORD_TYPE,
        recordId: id,
        newValue: { documentId: dto.documentId },
        ip: meta.ip,
      })

      return updated
    })
  }

  /**
   * Real-usage content, 11 Sep 2026 — the "create from scratch" half of
   * onboarding. Saves the draft's own structured content — the actual
   * PSMF being filled in section by section, matching
   * `kenya-psmf-template.docx`'s own 7-section shape — without touching
   * `documentId` at all; a human can save progress any number of times
   * before ever generating a real PDF from it.
   */
  async updateContent(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdatePsmfContentDto,
    meta: RequestMeta,
  ): Promise<Psmf> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.psmf.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'PSMF draft not found' })
      }
      if (existing.status !== 'draft') {
        throw new ConflictException({
          code: 'NOT_A_DRAFT',
          message: 'Only a draft PSMF can have its content edited',
        })
      }

      const updated = await tx.psmf.update({
        where: { id },
        data: { content: dto.content as Prisma.InputJsonValue },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'psmf_content_updated',
        recordType: PSMF_RECORD_TYPE,
        recordId: id,
        ip: meta.ip,
      })

      return updated
    })
  }

  /**
   * Real-usage content, 11 Sep 2026 — renders a real PDF from the
   * draft's own saved `content` (via `PsmfPdfService`) and attaches it
   * the exact same way `attachDocument()` attaches a manually-uploaded
   * one — the "create" and "upload" paths converge on `documentId` the
   * moment this runs, so `activate()` needs no awareness of which path
   * a given draft took. Mirrors `AuditPackService.generate()`'s own
   * transaction shape: the slow work (PDF rendering, the real upload)
   * happens *outside* any open Postgres transaction; only the final
   * `documentId` write is a short, fast, atomic step.
   */
  async generateDocument(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<Psmf> {
    const companyId = requireCompany(actor)

    const [existing, company] = await this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.psmf.findFirst({ where: { id, companyId } })
      if (!found) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'PSMF draft not found' })
      }
      if (found.status !== 'draft') {
        throw new ConflictException({
          code: 'NOT_A_DRAFT',
          message: 'Only a draft PSMF can have a document generated for it',
        })
      }
      const companyRow = await tx.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { name: true },
      })
      return [found, companyRow] as const
    })

    const pdf = await this.pdfService.render({
      companyName: company.name,
      version: existing.version,
      status: existing.status,
      createdAt: existing.createdAt,
      content: (existing.content ?? {}) as PsmfContent,
    })

    const pdfFile: DirectUploadFile = {
      buffer: pdf,
      originalname: `psmf-v${existing.version}-${new Date().toISOString().slice(0, 10)}.pdf`,
      mimetype: 'application/pdf',
    }
    const upload = await this.documentsService.uploadDirect(
      actor,
      PSMF_RECORD_TYPE,
      id,
      pdfFile,
      { title: `PSMF v${existing.version}` },
      meta,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const updated = await tx.psmf.update({
        where: { id },
        data: { documentId: upload.document.id },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'psmf_document_generated',
        recordType: PSMF_RECORD_TYPE,
        recordId: id,
        newValue: { documentId: upload.document.id },
        ip: meta.ip,
      })

      return updated
    })
  }

  /**
   * A PSMF with no document attached can never be activated — the one
   * place `documentId` is actually enforced as mandatory, deliberately
   * not in the schema (matches this repo's "constrained by application
   * logic" precedent elsewhere).
   */
  async activate(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<Psmf> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const target = await tx.psmf.findFirst({ where: { id, companyId } })
      if (!target) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'PSMF draft not found' })
      }
      if (target.status !== 'draft') {
        throw new ConflictException({
          code: 'NOT_A_DRAFT',
          message: 'Only a draft PSMF can be activated',
        })
      }
      if (!target.documentId) {
        throw new ConflictException({
          code: 'DOCUMENT_REQUIRED',
          message: 'Attach a PSMF document before activating this version',
        })
      }

      const previousActive = await tx.psmf.findFirst({ where: { companyId, status: 'active' } })
      if (previousActive) {
        await tx.psmf.update({
          where: { id: previousActive.id },
          data: { status: 'retired', retiredAt: new Date() },
        })
      }

      const activated = await tx.psmf.update({
        where: { id },
        data: { status: 'active', activatedAt: new Date() },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'psmf_activated',
        recordType: PSMF_RECORD_TYPE,
        recordId: id,
        oldValue: previousActive ? { previousActiveVersion: previousActive.version } : undefined,
        newValue: { version: activated.version },
        ip: meta.ip,
      })

      return activated
    })
  }

  async list(actor: AuthenticatedUser): Promise<Psmf[]> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      return tx.psmf.findMany({ where: { companyId }, orderBy: { version: 'desc' } })
    })
  }

  async getActive(companyId: string): Promise<Psmf | null> {
    return this.rls.runAsCompany(companyId, async (tx) => {
      return tx.psmf.findFirst({ where: { companyId, status: 'active' } })
    })
  }
}
