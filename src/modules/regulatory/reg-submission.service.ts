import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { RegSubmission } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { StorageService } from '../documents/storage.service'
import { REG_REGISTRATION_RECORD_TYPE } from './reg-dossier.service'
import { RegSubmissionPdfService } from './reg-submission-pdf.service'

export interface RequestMeta {
  ip?: string
}

/** Workflow states from which a submission package may be generated — the first attempt at Completeness Check, or a fresh attempt while responding to a regulator query. */
const GENERATABLE_STATES = new Set(['completeness_check', 'responding'])

const REG_SUBMISSION_RECORD_TYPE = 'reg_submission'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A submission is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * RegCloud (Phase 12) Stage 4 — Submit. Naming and shape deliberately
 * parallel `RegulatorySubmissionService` (VigiCloud Stage 12): generate a
 * real package (here, a PDF cover sheet — the enclosed documents are the
 * dossier's own already-uploaded `Document` rows, listed on the cover
 * sheet rather than re-embedded into a second copy), then a human
 * uploads/couriers/emails it themselves and comes back to confirm with
 * evidence — the exact same "No Gateway" honesty VigiCloud's own E2B
 * submission established, extended to every channel a registration
 * might go out through (portal, courier, or email), not just one.
 * `RegWorkflowGuards`' own evidence gate (registered on
 * `completeness_check`) is what actually enforces "this dossier can't
 * reach Submitted without a generated-and-evidenced submission" — this
 * service only ever creates the record the guard checks for.
 */
@Injectable()
export class RegSubmissionService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
    private readonly storageService: StorageService,
    private readonly pdfService: RegSubmissionPdfService,
  ) {}

  async list(actor: AuthenticatedUser, dossierId: string): Promise<RegSubmission[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.regSubmission.findMany({
        where: { companyId, regDossierId: dossierId },
        orderBy: { submissionNumber: 'desc' },
      }),
    )
  }

  async generate(
    actor: AuthenticatedUser,
    dossierId: string,
    meta: RequestMeta,
  ): Promise<RegSubmission> {
    const companyId = requireCompany(actor)

    const { dossier, workflowState, generatingUser, companyName, submissionNumber, channel } =
      await this.rls.runAsCompany(companyId, async (tx) => {
        const found = await tx.regDossier.findFirst({
          where: { id: dossierId, companyId },
          include: {
            product: { select: { brandName: true } },
            authority: { include: { country: true } },
            documentSlots: {
              include: {
                document: {
                  select: { title: true, versions: { orderBy: { version: 'desc' }, take: 1 } },
                },
                requiredDocumentDefinition: true,
              },
            },
          },
        })
        if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Dossier not found' })

        const instance = await tx.workflowInstance.findFirst({
          where: { recordType: REG_REGISTRATION_RECORD_TYPE, recordId: dossierId },
          include: { currentState: true },
        })
        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } })
        const user = await tx.user.findFirstOrThrow({ where: { id: actor.sub } })
        const nextSubmissionNumber =
          (await tx.regSubmission.count({ where: { regDossierId: dossierId } })) + 1

        // Stage 4 — resolves gracefully; an unconfigured authority never
        // blocks generation, it just falls back to the universally-safe
        // "a human can print and courier this" assumption. `reg_dossier`'s
        // own `ReportType` row is seeded by `seedRegCloudFoundation()`.
        const reportType = await tx.reportType.findUnique({ where: { typeKey: 'reg_dossier' } })
        const format = reportType
          ? await tx.submissionFormat.findFirst({
              where: {
                authorityId: found.authorityId,
                reportTypeId: reportType.id,
                status: 'active',
              },
            })
          : null

        return {
          dossier: found,
          workflowState: instance?.currentState.stateKey ?? null,
          generatingUser: user,
          companyName: company.name,
          submissionNumber: nextSubmissionNumber,
          channel: format?.channel ?? ('paper_pdf' as const),
        }
      })

    if (!workflowState || !GENERATABLE_STATES.has(workflowState)) {
      throw new ConflictException({
        code: 'DOSSIER_NOT_READY',
        message: `A submission can only be generated once this dossier has cleared the completeness check (currently: ${workflowState ?? 'unknown'}).`,
      })
    }

    // Real, previously-shipped-elsewhere discipline (VigiCloud Stage
    // 12's own gotcha) — an admin-uploaded emblem's real bytes are
    // fetched here, outside any transaction, alongside the PDF render
    // itself: neither needs a DB transaction held open around it, and a
    // missing/unreadable emblem never fails generation, it just falls
    // back to the bundled asset or no emblem at all.
    let emblemBuffer: Buffer | null = null
    if (dossier.authority.emblemObjectKey) {
      try {
        emblemBuffer = await this.storageService.getObjectBuffer(dossier.authority.emblemObjectKey)
      } catch {
        emblemBuffer = null
      }
    }

    const generatedAt = new Date()
    const pdf = await this.pdfService.render({
      authority: dossier.authority,
      emblemBuffer,
      countryOfficialName: dossier.authority.country.officialName ?? dossier.authority.country.name,
      companyName,
      productBrandName: dossier.product.brandName,
      productClass: dossier.productClass,
      route: dossier.route,
      submissionNumber,
      generatedAt,
      generatedByName: generatingUser.fullName,
      documents: dossier.documentSlots
        .filter((s) => s.document)
        .map((s) => ({
          label: s.requiredDocumentDefinition?.name ?? s.labelOverride ?? 'Untitled document',
          ctdModule: s.ctdModule,
          filename: s.document!.versions[0]?.filename ?? s.document!.title,
        })),
    })

    const submissionId = newId()
    const pdfFile: DirectUploadFile = {
      buffer: pdf,
      originalname: `submission-cover-sheet-v${submissionNumber}.pdf`,
      mimetype: 'application/pdf',
    }
    const upload = await this.documentsService.uploadDirect(
      actor,
      REG_SUBMISSION_RECORD_TYPE,
      submissionId,
      pdfFile,
      { title: `Submission Cover Sheet v${submissionNumber}` },
      meta,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.regSubmission.create({
        data: {
          id: submissionId,
          companyId,
          regDossierId: dossierId,
          authorityId: dossier.authorityId,
          submissionNumber,
          channel,
          coverSheetDocumentId: upload.document.id,
          generatedBy: actor.sub,
          generatedAt,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'reg_submission_generated',
        recordType: REG_REGISTRATION_RECORD_TYPE,
        recordId: dossierId,
        newValue: { submissionId, submissionNumber, channel },
        ip: meta.ip,
      })

      return created
    })
  }

  async attachEvidence(
    actor: AuthenticatedUser,
    submissionId: string,
    file: DirectUploadFile,
    meta: RequestMeta,
  ): Promise<RegSubmission> {
    const companyId = requireCompany(actor)

    const submission = await this.rls.runAsCompany(companyId, (tx) =>
      tx.regSubmission.findFirst({ where: { id: submissionId, companyId } }),
    )
    if (!submission)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Submission not found' })

    const upload = await this.documentsService.uploadDirect(
      actor,
      REG_SUBMISSION_RECORD_TYPE,
      submissionId,
      file,
      { title: 'Dispatch Evidence' },
      meta,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const updated = await tx.regSubmission.update({
        where: { id: submissionId },
        data: {
          evidenceDocumentId: upload.document.id,
          dispatchedAt: new Date(),
          dispatchedBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'reg_submission_evidence_attached',
        recordType: REG_REGISTRATION_RECORD_TYPE,
        recordId: submission.regDossierId,
        newValue: { submissionId, evidenceDocumentId: upload.document.id },
        ip: meta.ip,
      })

      return updated
    })
  }
}
