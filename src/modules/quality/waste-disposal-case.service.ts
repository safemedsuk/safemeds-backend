import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService, RequestMeta } from '../documents/documents.service'
import { StorageService } from '../documents/storage.service'
import { DocumentNumberingService } from './document-numbering.service'
import {
  AddWasteDestructionAttendeeDto,
  CreateWasteDisposalCaseDto,
  ListWasteDisposalCasesQueryDto,
  RecordWasteApplicationDto,
  RecordWasteDestructionDto,
  RecordWasteHandoverDto,
} from './dto/waste-disposal-case.dto'
import { WasteDestructionPdfService } from './waste-destruction-pdf.service'

export const WASTE_DISPOSAL_CASE_RECORD_TYPE = 'waste_disposal_case'

/**
 * Pass B (item B) — the regulatory anchors this case cites. Source:
 * "The Pharmacy and Poisons (Pharmaceutical Waste Management) Rules, LN 99
 * of 2022" (repo root PDF). Anything NOT in that document is labelled as a
 * client-process step in the code and in the testing guide, never presented
 * as a rule.
 *
 * - r.10  — waste generators keep records (date, trade name, API, dosage
 *           form, unit of issue, quantity, justification). The case's own
 *           product/batch/quantity/unit/weighedAt fields carry this.
 * - r.11(3) — waste is transferred to a person licensed to dispose of it at
 *           an approved facility (step 4's authorised-company handover).
 * - r.16(2) — disposal within ONE YEAR of generation. Shown as a warning;
 *           the rule runs from generation, which this record does not capture.
 * - r.17(1) — disposal is supervised by the Board at a NEMA-approved site
 *           (step 5's supervised destruction).
 * - r.17(2) and Second Schedule Part A — the application form; Part B — the
 *           application fee, KES 2,500 (step 2).
 * - r.17(3) and Second Schedule Part A — the Certificate of Safe Disposal,
 *           issued by the Board within THIRTY DAYS of the application (step 6).
 *
 * NOT in the regulation (client process only): the cage weighing, the
 * requirement of a "client representative" and "PPB officer" present at
 * destruction, the destruction photos, and the PPB-verified flag on the
 * disposal company's certificate. These are enforced here because the client
 * process requires them, and they are labelled as such.
 */
export const PPB_APPLICATION_FEE_KES = 2500 // Second Schedule, Part B
export const PPB_CERTIFICATE_DAYS = 30 // r.17(3)
export const DISPOSAL_WITHIN_DAYS = 365 // r.16(2)

export type CaseStepKey = 'application' | 'evidence' | 'handover' | 'destruction' | 'ppbCertificate'

/** Enforced order. Step numbers are the client-process numbers from the case screen. */
export const STEP_ORDER: CaseStepKey[] = [
  'application',
  'evidence',
  'handover',
  'destruction',
  'ppbCertificate',
]
export const STEP_NUMBER: Record<CaseStepKey, number> = {
  application: 2,
  evidence: 3,
  handover: 4,
  destruction: 5,
  ppbCertificate: 6,
}
export const STEP_LABEL: Record<CaseStepKey, string> = {
  application: 'Apply to PPB and pay the statutory fee',
  evidence: 'Attach invoice and payment evidence',
  handover: 'Hand over to an authorised disposal company and verify its certificate',
  destruction: 'Destruction under supervision (with client representative and PPB officer present)',
  ppbCertificate: 'Attach the PPB Certificate of Safe Disposal',
}

export const EVIDENCE_KINDS = [
  'invoice',
  'payment_receipt',
  'handover_certificate',
  'ppb_certificate',
] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]
const EVIDENCE_TITLES: Record<EvidenceKind, string> = {
  invoice: 'PPB disposal fee invoice',
  payment_receipt: 'PPB disposal fee payment receipt',
  handover_certificate: 'Disposal company certificate',
  ppb_certificate: 'PPB Certificate of Safe Disposal',
}

/** The fields step completion is derived from. Exported so the derivation is unit-testable without Prisma. */
export interface WasteCaseStepFields {
  applicationReference: string | null
  feeAmountKes: number | null
  applicationSubmittedAt: Date | null
  invoiceDocumentId: string | null
  paymentReceiptDocumentId: string | null
  disposalCompanyName: string | null
  handoverCertificateDocumentId: string | null
  ppbVerifiedAt: Date | null
  destructionDate: Date | null
  destructionLocation: string | null
  destructionPdfDocumentId: string | null
  ppbCertificateDocumentId: string | null
}

export interface WasteCaseAttendeeLike {
  attendeeRole: string
  withdrawnAt: Date | null
}

export type WasteCaseSteps = Record<CaseStepKey, boolean>

/**
 * Derives every step's completion from the evidence actually on the record.
 * Steps are never stored as flags, so the step view cannot drift from the
 * fields and documents it summarises.
 */
export function deriveWasteCaseSteps(
  c: WasteCaseStepFields,
  attendees: WasteCaseAttendeeLike[],
): WasteCaseSteps {
  const activeAttendees = attendees.filter((a) => a.withdrawnAt === null)
  const hasRole = (role: string) => activeAttendees.some((a) => a.attendeeRole === role)
  return {
    application: !!c.applicationReference && c.feeAmountKes !== null && !!c.applicationSubmittedAt,
    evidence: !!c.invoiceDocumentId && !!c.paymentReceiptDocumentId,
    handover: !!c.disposalCompanyName && !!c.handoverCertificateDocumentId && !!c.ppbVerifiedAt,
    destruction:
      !!c.destructionDate &&
      !!c.destructionLocation &&
      !!c.destructionPdfDocumentId &&
      hasRole('client_representative') &&
      hasRole('ppb_officer'),
    ppbCertificate: !!c.ppbCertificateDocumentId,
  }
}

/** The first incomplete step number (2–6), or 7 once every step is done (the closure step). */
export function currentWasteCaseStep(steps: WasteCaseSteps): number {
  for (const key of STEP_ORDER) {
    if (!steps[key]) return STEP_NUMBER[key]
  }
  return 7
}

/** Plain-language reasons closure is refused. Empty array = closable. */
export function wasteCaseClosureBlockers(steps: WasteCaseSteps): string[] {
  const blockers: string[] = []
  if (!steps.application)
    blockers.push(
      'Step 2: record the PPB application reference, the fee paid and the submission date.',
    )
  if (!steps.evidence) blockers.push('Step 3: attach both the invoice and the payment receipt.')
  if (!steps.handover)
    blockers.push(
      'Step 4: record the disposal company, attach its certificate, and mark it verified by PPB.',
    )
  if (!steps.destruction)
    blockers.push(
      'Step 5: record the destruction date and location, add at least one client representative and one PPB officer, and upload the destruction photos.',
    )
  if (!steps.ppbCertificate) blockers.push('Step 6: attach the PPB Certificate of Safe Disposal.')
  return blockers
}

const CASE_INCLUDE = {
  product: { select: { id: true, brandName: true, genericName: true, strength: true } },
  batch: { select: { id: true, batchNumber: true, expiresOn: true } },
  items: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      product: { select: { id: true, brandName: true, genericName: true, strength: true } },
      batch: { select: { id: true, batchNumber: true, expiresOn: true } },
    },
  },
  invoiceDocument: { select: { id: true, title: true } },
  paymentReceiptDocument: { select: { id: true, title: true } },
  handoverCertificateDocument: { select: { id: true, title: true } },
  destructionPdfDocument: { select: { id: true, title: true } },
  ppbCertificateDocument: { select: { id: true, title: true } },
  attendees: { orderBy: { sortOrder: 'asc' as const } },
  photos: {
    orderBy: { sortOrder: 'asc' as const },
    include: { document: { select: { id: true, title: true } } },
  },
} satisfies Prisma.WasteDisposalCaseInclude

type LoadedCase = Prisma.WasteDisposalCaseGetPayload<{ include: typeof CASE_INCLUDE }>

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Waste disposal cases are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

/**
 * QualCloud Phase 1 Pass B (item B) — the 7-step pharmaceutical waste
 * disposal case. Every step writes its own audit entry. Step order is
 * enforced by `assertCanEdit()`: a step may be entered or corrected only
 * while every earlier step is complete AND no later step is complete, so an
 * action can never silently rewrite evidence a later step already relies on.
 * Closure requires steps 2–6 complete and the manager permission
 * `quality.close_waste_disposal` (enforced at the controller).
 *
 * Evidence uploads go through `DocumentsService.uploadDirect()` OUTSIDE any
 * open transaction (it opens its own company-scoped transaction and performs
 * an R2 upload — the slow-I/O-outside-transaction rule in CLAUDE.md). The
 * link to the case is then written in a short second transaction that
 * re-checks the step gate. A failed second step can leave an orphaned
 * Document, which is acceptable: the file is still audited and retained.
 */
@Injectable()
export class WasteDisposalCaseService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
    private readonly storage: StorageService,
    private readonly documentNumbering: DocumentNumberingService,
    private readonly pdfService: WasteDestructionPdfService,
  ) {}

  // ---------------------------------------------------------------- reads

  async list(
    actor: AuthenticatedUser,
    query: ListWasteDisposalCasesQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.WasteDisposalCaseWhereInput = {
        companyId,
        ...(query.status ? { status: query.status } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.wasteDisposalCase.findMany({
          where,
          include: CASE_INCLUDE,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.wasteDisposalCase.count({ where }),
      ])
      return paginate(
        rows.map((row) => this.toView(row)),
        total,
        query,
      )
    })
  }

  async get(actor: AuthenticatedUser, id: string) {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) =>
      this.toView(await this.loadCase(tx, companyId, id)),
    )
  }

  // ---------------------------------------------------------------- step 1

  async create(actor: AuthenticatedUser, dto: CreateWasteDisposalCaseDto, meta: RequestMeta) {
    const companyId = requireCompany(actor)
    const weighedAt = new Date(dto.weighedAt)
    if (weighedAt.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new BadRequestException({
        code: 'WEIGHED_AT_IN_FUTURE',
        message: 'The weighing date cannot be in the future',
      })
    }

    // Fold a single legacy productId/batchId pair into a one-entry items list.
    const requestedItems: Array<{ productId: string; batchId: string }> =
      dto.items && dto.items.length > 0
        ? dto.items
        : dto.productId && dto.batchId
          ? [{ productId: dto.productId, batchId: dto.batchId }]
          : []

    const id = await this.rls.runAsCompany(companyId, async (tx) => {
      let productId: string | null = null
      let batchId: string | null = null
      if (dto.productId) {
        const product = await tx.product.findFirst({ where: { id: dto.productId, companyId } })
        if (!product)
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' })
        productId = product.id
      }
      if (dto.batchId) {
        const batch = await tx.batch.findFirst({ where: { id: dto.batchId, companyId } })
        if (!batch) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Batch not found' })
        if (productId && batch.productId !== productId) {
          throw new BadRequestException({
            code: 'BATCH_PRODUCT_MISMATCH',
            message:
              'That batch belongs to a different product. Pick the batch from the selected product.',
          })
        }
        batchId = batch.id
        productId = productId ?? batch.productId
      }

      const resolvedItems: Array<{ productId: string; batchId: string }> = []
      const seenBatchIds = new Set<string>()
      for (const entry of requestedItems) {
        if (seenBatchIds.has(entry.batchId)) continue
        seenBatchIds.add(entry.batchId)
        const batch = await tx.batch.findFirst({ where: { id: entry.batchId, companyId } })
        if (!batch) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Batch not found' })
        const product = await tx.product.findFirst({ where: { id: entry.productId, companyId } })
        if (!product)
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' })
        if (batch.productId !== product.id) {
          throw new BadRequestException({
            code: 'BATCH_PRODUCT_MISMATCH',
            message: `Batch ${batch.batchNumber} belongs to a different product than the one selected for it.`,
          })
        }
        resolvedItems.push({ productId: product.id, batchId: batch.id })
      }
      // Keep the single-column fields populated from the first item for any
      // old code path (reports, exports) that still reads them directly.
      if (resolvedItems.length > 0) {
        productId = resolvedItems[0].productId
        batchId = resolvedItems[0].batchId
      }

      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { name: true },
      })
      const caseNumber = await this.documentNumbering.allocate(tx, {
        companyId,
        companyName: company?.name ?? '',
        documentType: WASTE_DISPOSAL_CASE_RECORD_TYPE,
      })

      const created = await tx.wasteDisposalCase.create({
        data: {
          id: newId(),
          companyId,
          caseNumber,
          status: 'open',
          productId,
          batchId,
          wasteDescription: dto.wasteDescription,
          quantity: dto.quantity,
          unit: dto.unit,
          weighedAt,
          createdBy: actor.sub,
        },
      })

      if (resolvedItems.length > 0) {
        await tx.wasteDisposalCaseItem.createMany({
          data: resolvedItems.map((entry, index) => ({
            id: newId(),
            companyId,
            caseId: created.id,
            productId: entry.productId,
            batchId: entry.batchId,
            sortOrder: index,
          })),
        })
      }

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'waste_disposal_case_created',
        recordType: WASTE_DISPOSAL_CASE_RECORD_TYPE,
        recordId: created.id,
        newValue: {
          caseNumber,
          quantity: dto.quantity,
          unit: dto.unit,
          weighedAt: dto.weighedAt,
          productId,
          batchId,
          items: resolvedItems,
        },
        ip: meta.ip,
      })
      return created.id
    })
    return this.get(actor, id)
  }

  // ---------------------------------------------------------------- step 2

  async recordApplication(
    actor: AuthenticatedUser,
    id: string,
    dto: RecordWasteApplicationDto,
    meta: RequestMeta,
  ) {
    const companyId = requireCompany(actor)
    await this.rls.runAsCompany(companyId, async (tx) => {
      const current = await this.loadCase(tx, companyId, id)
      this.assertCanEdit(current, 'application')
      const applicationSubmittedAt = new Date(dto.applicationSubmittedAt)
      await tx.wasteDisposalCase.update({
        where: { id },
        data: {
          applicationReference: dto.applicationReference,
          invoiceReference: dto.invoiceReference,
          feeAmountKes: dto.feeAmountKes,
          applicationSubmittedAt,
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'waste_disposal_application_recorded',
        recordType: WASTE_DISPOSAL_CASE_RECORD_TYPE,
        recordId: id,
        oldValue: {
          applicationReference: current.applicationReference,
          feeAmountKes: current.feeAmountKes,
        },
        newValue: {
          applicationReference: dto.applicationReference,
          invoiceReference: dto.invoiceReference,
          feeAmountKes: dto.feeAmountKes,
          applicationSubmittedAt: dto.applicationSubmittedAt,
        },
        ip: meta.ip,
      })
    })
    return this.get(actor, id)
  }

  // ---------------------------------------------------------------- step 3, 4 (certificate), 6 — evidence uploads

  async attachEvidence(
    actor: AuthenticatedUser,
    id: string,
    kind: EvidenceKind,
    file: DirectUploadFile,
    meta: RequestMeta,
  ) {
    const companyId = requireCompany(actor)
    const stepKey = this.stepForEvidence(kind)
    const caseNumber = await this.rls.runAsCompany(companyId, async (tx) => {
      const current = await this.loadCase(tx, companyId, id)
      this.assertCanEdit(current, stepKey)
      return current.caseNumber
    })

    const uploaded = await this.documentsService.uploadDirect(
      actor,
      WASTE_DISPOSAL_CASE_RECORD_TYPE,
      id,
      file,
      { title: `${EVIDENCE_TITLES[kind]} — ${caseNumber}` },
      meta,
    )

    await this.rls.runAsCompany(companyId, async (tx) => {
      const current = await this.loadCase(tx, companyId, id)
      this.assertCanEdit(current, stepKey)
      const now = new Date()
      const documentId = uploaded.document.id
      switch (kind) {
        case 'invoice':
        case 'payment_receipt': {
          const invoiceDocumentId = kind === 'invoice' ? documentId : current.invoiceDocumentId
          const paymentReceiptDocumentId =
            kind === 'payment_receipt' ? documentId : current.paymentReceiptDocumentId
          await tx.wasteDisposalCase.update({
            where: { id },
            data: {
              invoiceDocumentId,
              paymentReceiptDocumentId,
              evidenceAttachedAt: invoiceDocumentId && paymentReceiptDocumentId ? now : null,
            },
          })
          break
        }
        case 'handover_certificate':
          // A replaced certificate must be re-verified: the verification flag belonged to the old file.
          await tx.wasteDisposalCase.update({
            where: { id },
            data: {
              handoverCertificateDocumentId: documentId,
              ppbVerifiedAt: null,
              ppbVerifiedByUserId: null,
            },
          })
          break
        case 'ppb_certificate':
          await tx.wasteDisposalCase.update({
            where: { id },
            data: { ppbCertificateDocumentId: documentId, ppbCertificateAttachedAt: now },
          })
          break
      }

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: `waste_disposal_evidence_attached_${kind}`,
        recordType: WASTE_DISPOSAL_CASE_RECORD_TYPE,
        recordId: id,
        newValue: { kind, documentId, filename: file.originalname },
        ip: meta.ip,
      })
    })
    return this.get(actor, id)
  }

  // ---------------------------------------------------------------- step 4

  async recordHandover(
    actor: AuthenticatedUser,
    id: string,
    dto: RecordWasteHandoverDto,
    meta: RequestMeta,
  ) {
    const companyId = requireCompany(actor)
    await this.rls.runAsCompany(companyId, async (tx) => {
      const current = await this.loadCase(tx, companyId, id)
      this.assertCanEdit(current, 'handover')
      await tx.wasteDisposalCase.update({
        where: { id },
        data: {
          disposalCompanyName: dto.disposalCompanyName,
          handedOverAt: new Date(dto.handedOverAt),
          // Any change to the handover details invalidates a previous PPB verification.
          ppbVerifiedAt: null,
          ppbVerifiedByUserId: null,
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'waste_disposal_handover_recorded',
        recordType: WASTE_DISPOSAL_CASE_RECORD_TYPE,
        recordId: id,
        oldValue: { disposalCompanyName: current.disposalCompanyName },
        newValue: { disposalCompanyName: dto.disposalCompanyName, handedOverAt: dto.handedOverAt },
        ip: meta.ip,
      })
    })
    return this.get(actor, id)
  }

  /** The "verified-by-PPB" flag, set by a user after checking the disposal company's certificate (client process, not regulation). */
  async verifyHandover(actor: AuthenticatedUser, id: string, meta: RequestMeta) {
    const companyId = requireCompany(actor)
    await this.rls.runAsCompany(companyId, async (tx) => {
      const current = await this.loadCase(tx, companyId, id)
      this.assertCanEdit(current, 'handover')
      if (!current.disposalCompanyName || !current.handoverCertificateDocumentId) {
        throw new ConflictException({
          code: 'HANDOVER_INCOMPLETE',
          message:
            'Record the disposal company and attach its certificate before marking it verified.',
        })
      }
      const now = new Date()
      await tx.wasteDisposalCase.update({
        where: { id },
        data: { ppbVerifiedAt: now, ppbVerifiedByUserId: actor.sub },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'waste_disposal_handover_verified',
        recordType: WASTE_DISPOSAL_CASE_RECORD_TYPE,
        recordId: id,
        newValue: {
          disposalCompanyName: current.disposalCompanyName,
          verifiedAt: now.toISOString(),
        },
        ip: meta.ip,
      })
    })
    return this.get(actor, id)
  }

  // ---------------------------------------------------------------- step 5

  async recordDestruction(
    actor: AuthenticatedUser,
    id: string,
    dto: RecordWasteDestructionDto,
    meta: RequestMeta,
  ) {
    const companyId = requireCompany(actor)
    await this.rls.runAsCompany(companyId, async (tx) => {
      const current = await this.loadCase(tx, companyId, id)
      this.assertCanEdit(current, 'destruction')
      await tx.wasteDisposalCase.update({
        where: { id },
        data: {
          destructionDate: new Date(dto.destructionDate),
          destructionLocation: dto.destructionLocation,
          destructionRecordedAt: new Date(),
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'waste_disposal_destruction_recorded',
        recordType: WASTE_DISPOSAL_CASE_RECORD_TYPE,
        recordId: id,
        oldValue: {
          destructionDate: current.destructionDate,
          destructionLocation: current.destructionLocation,
        },
        newValue: {
          destructionDate: dto.destructionDate,
          destructionLocation: dto.destructionLocation,
        },
        ip: meta.ip,
      })
    })
    return this.get(actor, id)
  }

  async addAttendee(
    actor: AuthenticatedUser,
    id: string,
    dto: AddWasteDestructionAttendeeDto,
    meta: RequestMeta,
  ) {
    const companyId = requireCompany(actor)
    await this.rls.runAsCompany(companyId, async (tx) => {
      const current = await this.loadCase(tx, companyId, id)
      this.assertCanEdit(current, 'destruction')
      const sortOrder = current.attendees.length
      const attendee = await tx.wasteDisposalCaseAttendee.create({
        data: {
          id: newId(),
          companyId,
          caseId: id,
          name: dto.name,
          organisation: dto.organisation,
          attendeeRole: dto.attendeeRole,
          sortOrder,
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'waste_disposal_attendee_added',
        recordType: WASTE_DISPOSAL_CASE_RECORD_TYPE,
        recordId: id,
        newValue: {
          attendeeId: attendee.id,
          name: dto.name,
          organisation: dto.organisation,
          attendeeRole: dto.attendeeRole,
        },
        ip: meta.ip,
      })
    })
    return this.get(actor, id)
  }

  async withdrawAttendee(
    actor: AuthenticatedUser,
    id: string,
    attendeeId: string,
    meta: RequestMeta,
  ) {
    const companyId = requireCompany(actor)
    await this.rls.runAsCompany(companyId, async (tx) => {
      const current = await this.loadCase(tx, companyId, id)
      this.assertCanEdit(current, 'destruction')
      const attendee = current.attendees.find((a) => a.id === attendeeId)
      if (!attendee)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Attendee not found on this case',
        })
      if (attendee.withdrawnAt) {
        throw new ConflictException({
          code: 'ALREADY_WITHDRAWN',
          message: 'This attendee has already been withdrawn',
        })
      }
      const now = new Date()
      await tx.wasteDisposalCaseAttendee.update({
        where: { id: attendeeId },
        data: { withdrawnAt: now },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'waste_disposal_attendee_withdrawn',
        recordType: WASTE_DISPOSAL_CASE_RECORD_TYPE,
        recordId: id,
        oldValue: { attendeeId, name: attendee.name, attendeeRole: attendee.attendeeRole },
        newValue: { withdrawnAt: now.toISOString() },
        ip: meta.ip,
      })
    })
    return this.get(actor, id)
  }

  /**
   * Uploads the destruction photos (each kept as its own original Document)
   * and regenerates ONE combined PDF from every photo on the case so far.
   * Earlier combined PDFs are kept as archived Documents, never overwritten.
   */
  async addDestructionPhotos(
    actor: AuthenticatedUser,
    id: string,
    files: DirectUploadFile[],
    meta: RequestMeta,
  ) {
    const companyId = requireCompany(actor)
    if (files.length === 0) {
      throw new BadRequestException({ code: 'NO_PHOTOS', message: 'Choose at least one photo' })
    }
    for (const file of files) {
      if (!this.pdfService.isSupportedMimeType(file.mimetype)) {
        throw new BadRequestException({
          code: 'UNSUPPORTED_PHOTO_TYPE',
          message: `"${file.originalname}" is not a JPEG or PNG image. Photos must be JPEG or PNG so they can be combined into one PDF.`,
        })
      }
    }

    const snapshot = await this.rls.runAsCompany(companyId, async (tx) => {
      const current = await this.loadCase(tx, companyId, id)
      this.assertCanEdit(current, 'destruction')
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { name: true },
      })
      const previousDocIds = current.photos.map((p) => p.documentId)
      const previousDocs = previousDocIds.length
        ? await tx.document.findMany({
            where: { id: { in: previousDocIds }, companyId },
            include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
          })
        : []
      const byId = new Map(previousDocs.map((d) => [d.id, d]))
      const previous = current.photos.map((p) => {
        const doc = byId.get(p.documentId)
        const version = doc?.versions[0]
        return {
          key: version?.key ?? '',
          filename: version?.filename ?? 'photo',
          mimetype: version?.contentType ?? 'image/jpeg',
        }
      })
      return {
        caseNumber: current.caseNumber,
        companyName: company?.name ?? '',
        previous,
        nextSort: current.photos.length,
      }
    })

    // Slow I/O — deliberately outside any transaction.
    const previousPhotos = await Promise.all(
      snapshot.previous.map(async (p) => ({
        buffer: await this.storage.getObjectBuffer(p.key),
        filename: p.filename,
        mimetype: p.mimetype,
      })),
    )

    const uploadedOriginals: Array<{ document: { id: string } }> = []
    for (const file of files) {
      uploadedOriginals.push(
        await this.documentsService.uploadDirect(
          actor,
          WASTE_DISPOSAL_CASE_RECORD_TYPE,
          id,
          file,
          { title: `Destruction photo — ${snapshot.caseNumber} — ${file.originalname}` },
          meta,
        ),
      )
    }

    const pdfBuffer = await this.pdfService.buildPhotoPdf({
      caseNumber: snapshot.caseNumber,
      companyName: snapshot.companyName,
      photos: [
        ...previousPhotos,
        ...files.map((f) => ({ buffer: f.buffer, filename: f.originalname, mimetype: f.mimetype })),
      ],
    })
    const combined = await this.documentsService.uploadDirect(
      actor,
      WASTE_DISPOSAL_CASE_RECORD_TYPE,
      id,
      {
        buffer: pdfBuffer,
        originalname: `${snapshot.caseNumber}-destruction-photos.pdf`,
        mimetype: 'application/pdf',
      },
      { title: `Destruction photos (combined PDF) — ${snapshot.caseNumber}` },
      meta,
    )

    await this.rls.runAsCompany(companyId, async (tx) => {
      const current = await this.loadCase(tx, companyId, id)
      this.assertCanEdit(current, 'destruction')
      let sortOrder = current.photos.length
      for (const original of uploadedOriginals) {
        await tx.wasteDisposalCasePhoto.create({
          data: {
            id: newId(),
            companyId,
            caseId: id,
            documentId: original.document.id,
            sortOrder: sortOrder++,
          },
        })
      }
      await tx.wasteDisposalCase.update({
        where: { id },
        data: { destructionPdfDocumentId: combined.document.id },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'waste_disposal_destruction_photos_added',
        recordType: WASTE_DISPOSAL_CASE_RECORD_TYPE,
        recordId: id,
        newValue: {
          photosAdded: files.length,
          totalPhotos: current.photos.length + files.length,
          combinedPdfDocumentId: combined.document.id,
        },
        ip: meta.ip,
      })
    })
    return this.get(actor, id)
  }

  // ---------------------------------------------------------------- step 7

  /** Closure. Manager-level — the controller enforces `quality.close_waste_disposal`. */
  async close(actor: AuthenticatedUser, id: string, meta: RequestMeta) {
    const companyId = requireCompany(actor)
    await this.rls.runAsCompany(companyId, async (tx) => {
      const current = await this.loadCase(tx, companyId, id)
      if (current.status === 'closed') {
        throw new ConflictException({
          code: 'ALREADY_CLOSED',
          message: 'This disposal case is already closed',
        })
      }
      const blockers = wasteCaseClosureBlockers(deriveWasteCaseSteps(current, current.attendees))
      if (blockers.length > 0) {
        throw new ConflictException({
          code: 'CLOSURE_BLOCKED',
          message: `This case cannot be closed yet. ${blockers.join(' ')}`,
        })
      }
      const now = new Date()
      await tx.wasteDisposalCase.update({
        where: { id },
        data: { status: 'closed', closedAt: now, closedByUserId: actor.sub },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'waste_disposal_case_closed',
        recordType: WASTE_DISPOSAL_CASE_RECORD_TYPE,
        recordId: id,
        oldValue: { status: 'open' },
        newValue: { status: 'closed', closedAt: now.toISOString() },
        ip: meta.ip,
      })
    })
    return this.get(actor, id)
  }

  // ---------------------------------------------------------------- internals

  private stepForEvidence(kind: EvidenceKind): CaseStepKey {
    switch (kind) {
      case 'invoice':
      case 'payment_receipt':
        return 'evidence'
      case 'handover_certificate':
        return 'handover'
      case 'ppb_certificate':
        return 'ppbCertificate'
    }
  }

  private async loadCase(
    tx: Prisma.TransactionClient,
    companyId: string,
    id: string,
  ): Promise<LoadedCase> {
    const found = await tx.wasteDisposalCase.findFirst({
      where: { id, companyId },
      include: CASE_INCLUDE,
    })
    if (!found)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Waste disposal case not found' })
    return found
  }

  /**
   * Refuses an edit to `key` unless every earlier step is complete, no
   * later step is complete, and the case is still open. Re-doing the same
   * step is allowed while nothing after it is complete.
   */
  private assertCanEdit(current: LoadedCase, key: CaseStepKey): void {
    if (current.status === 'closed') {
      throw new ConflictException({
        code: 'CASE_CLOSED',
        message: 'This disposal case is closed and can no longer be changed',
      })
    }
    const steps = deriveWasteCaseSteps(current, current.attendees)
    const index = STEP_ORDER.indexOf(key)
    for (const earlier of STEP_ORDER.slice(0, index)) {
      if (!steps[earlier]) {
        throw new ConflictException({
          code: 'STEP_OUT_OF_ORDER',
          message: `Complete step ${STEP_NUMBER[earlier]} first: ${STEP_LABEL[earlier]}.`,
        })
      }
    }
    for (const later of STEP_ORDER.slice(index + 1)) {
      if (steps[later]) {
        throw new ConflictException({
          code: 'LATER_STEP_COMPLETE',
          message: `Step ${STEP_NUMBER[later]} (${STEP_LABEL[later]}) is already complete, so step ${STEP_NUMBER[key]} can no longer be changed. Corrections after this point are not supported in this build.`,
        })
      }
    }
  }

  private toView(c: LoadedCase) {
    const steps = deriveWasteCaseSteps(c, c.attendees)
    const activeAttendees = c.attendees.filter((a) => a.withdrawnAt === null)
    const withdrawnAttendees = c.attendees.filter((a) => a.withdrawnAt !== null)
    const disposalDeadlineAt = addDays(c.weighedAt, DISPOSAL_WITHIN_DAYS)
    const ppbCertificateDueAt = c.applicationSubmittedAt
      ? addDays(c.applicationSubmittedAt, PPB_CERTIFICATE_DAYS)
      : null
    const warnings: string[] = []
    if (c.destructionDate && c.destructionDate.getTime() > disposalDeadlineAt.getTime()) {
      warnings.push(
        'Destruction is more than one year after the weighing date. Regulation r.16(2) requires disposal within one year of generation; this record captures the weighing date, not the generation date, so confirm the generation date.',
      )
    }
    if (c.feeAmountKes !== null && c.feeAmountKes !== PPB_APPLICATION_FEE_KES) {
      warnings.push(
        `The recorded fee (KES ${c.feeAmountKes}) differs from the Second Schedule Part B fee of KES ${PPB_APPLICATION_FEE_KES}.`,
      )
    }
    return {
      id: c.id,
      caseNumber: c.caseNumber,
      status: c.status,
      currentStep: c.status === 'closed' ? 7 : currentWasteCaseStep(steps),
      steps,
      closureBlockers: c.status === 'closed' ? [] : wasteCaseClosureBlockers(steps),
      product: c.product,
      batch: c.batch,
      items: c.items.map((i) => ({ id: i.id, product: i.product, batch: i.batch })),
      wasteDescription: c.wasteDescription,
      quantity: c.quantity,
      unit: c.unit,
      weighedAt: c.weighedAt,
      disposalDeadlineAt,
      step2Application: {
        applicationReference: c.applicationReference,
        invoiceReference: c.invoiceReference,
        feeAmountKes: c.feeAmountKes,
        feeScheduledKes: PPB_APPLICATION_FEE_KES,
        applicationSubmittedAt: c.applicationSubmittedAt,
        certificateDueAt: ppbCertificateDueAt,
      },
      step3Evidence: {
        invoiceDocument: c.invoiceDocument,
        paymentReceiptDocument: c.paymentReceiptDocument,
        evidenceAttachedAt: c.evidenceAttachedAt,
      },
      step4Handover: {
        disposalCompanyName: c.disposalCompanyName,
        handoverCertificateDocument: c.handoverCertificateDocument,
        handedOverAt: c.handedOverAt,
        ppbVerifiedAt: c.ppbVerifiedAt,
        ppbVerifiedByUserId: c.ppbVerifiedByUserId,
      },
      step5Destruction: {
        destructionDate: c.destructionDate,
        destructionLocation: c.destructionLocation,
        destructionRecordedAt: c.destructionRecordedAt,
        attendees: activeAttendees,
        withdrawnAttendees,
        photos: c.photos.map((p) => ({ id: p.id, sortOrder: p.sortOrder, document: p.document })),
        combinedPdfDocument: c.destructionPdfDocument,
      },
      step6PpbCertificate: {
        document: c.ppbCertificateDocument,
        attachedAt: c.ppbCertificateAttachedAt,
      },
      step7Closure: {
        closedAt: c.closedAt,
        closedByUserId: c.closedByUserId,
      },
      warnings,
    }
  }
}
