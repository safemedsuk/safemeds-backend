import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { RegRetention } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { CreateRegRetentionDto } from './dto/create-reg-retention.dto'
import { RegRetentionPdfService } from './reg-retention-pdf.service'

export interface RequestMeta {
  ip?: string
}

const REG_RETENTION_RECORD_TYPE = 'reg_retention'
const REGISTRATION_RECORD_TYPE = 'product_registration'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A retention is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * testing-correction-explanation.md §3.3/§3.7 — a real, honest annual
 * retention record: upload the regulator's invoice and proof it was
 * paid, in one request, and a real one-page certificate is generated
 * immediately — deliberately **not** a `RegDossier` (no query/response
 * cycle, no completeness gate, no multi-week review; see `RegRetention`'s
 * own schema doc comment for the full reasoning) and deliberately not a
 * workflow-engine instance either (one person logging a real transaction,
 * the same shape `SafetyAlert` already established in VigiCloud).
 */
@Injectable()
export class RegRetentionService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
    private readonly pdfService: RegRetentionPdfService,
  ) {}

  async list(actor: AuthenticatedUser, productRegistrationId: string): Promise<RegRetention[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.regRetention.findMany({
        where: { companyId, productRegistrationId },
        orderBy: { year: 'desc' },
      }),
    )
  }

  /** The company-wide "All Retentions" list, independent of any one registration. */
  async listAllForCompany(actor: AuthenticatedUser): Promise<
    (RegRetention & { productRegistration: { registrationNumber: string; product: { brandName: string } } })[]
  > {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.regRetention.findMany({
        where: { companyId },
        include: {
          productRegistration: {
            select: { registrationNumber: true, product: { select: { brandName: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    )
  }

  async get(actor: AuthenticatedUser, id: string): Promise<RegRetention> {
    const companyId = requireCompany(actor)
    const found = await this.rls.runAsCompany(companyId, (tx) =>
      tx.regRetention.findFirst({ where: { id, companyId } }),
    )
    if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Retention not found' })
    return found
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateRegRetentionDto,
    invoiceFile: DirectUploadFile,
    proofOfPaymentFile: DirectUploadFile,
    meta: RequestMeta,
  ): Promise<RegRetention> {
    const companyId = requireCompany(actor)

    const { registration, companyName, actorFullName } = await this.rls.runAsCompany(
      companyId,
      async (tx) => {
        const [registration, company, user] = await Promise.all([
          tx.productRegistration.findFirst({
            where: { id: dto.productRegistrationId, companyId },
            include: {
              product: { select: { brandName: true } },
              authority: { select: { name: true } },
            },
          }),
          tx.company.findUniqueOrThrow({ where: { id: companyId } }),
          tx.user.findFirstOrThrow({ where: { id: actor.sub } }),
        ])
        return { registration, companyName: company.name, actorFullName: user.fullName }
      },
    )
    if (!registration)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Registration not found' })

    // testing-correction-explanation.md §3.5 — decision #2: retention
    // needs the registration in "good shape" — active, not expired, and
    // not already retained for this year.
    if (registration.status === 'withdrawn') {
      throw new ConflictException({
        code: 'REGISTRATION_WITHDRAWN',
        message: 'This registration has been withdrawn and cannot be retained.',
      })
    }
    if (registration.expiresOn < new Date()) {
      throw new ConflictException({
        code: 'REGISTRATION_EXPIRED',
        message:
          'This registration has already expired — retention is no longer available. Start a fresh re-registration instead.',
      })
    }
    const existingForYear = await this.rls.runAsCompany(companyId, (tx) =>
      tx.regRetention.findFirst({ where: { productRegistrationId: registration.id, year: dto.year } }),
    )
    if (existingForYear) {
      throw new ConflictException({
        code: 'RETENTION_ALREADY_EXISTS_FOR_YEAR',
        message: `A retention for ${dto.year} has already been logged for this registration.`,
      })
    }

    const retentionId = newId()
    const [invoiceUpload, proofOfPaymentUpload] = await Promise.all([
      this.documentsService.uploadDirect(
        actor,
        REG_RETENTION_RECORD_TYPE,
        retentionId,
        invoiceFile,
        { title: 'Retention Invoice' },
        meta,
      ),
      this.documentsService.uploadDirect(
        actor,
        REG_RETENTION_RECORD_TYPE,
        retentionId,
        proofOfPaymentFile,
        { title: 'Proof of Payment' },
        meta,
      ),
    ])

    const displayCode = await this.rls.runAsCompany(companyId, async (tx) => {
      const count = await tx.regRetention.count({ where: { companyId } })
      return `RET-${String(count + 1).padStart(5, '0')}-${registration.registrationNumber}`
    })

    // The certificate PDF render is slow, external-library work — done
    // outside any open transaction, matching this project's own
    // established "never hold a Postgres transaction open across slow
    // work" discipline (RegulatorySubmissionService's own precedent).
    const certificateBuffer = await this.pdfService.render({
      companyName,
      productBrandName: registration.product.brandName,
      registrationNumber: registration.registrationNumber,
      authorityName: registration.authority.name,
      year: dto.year,
      displayCode,
      paidAt: new Date(dto.paidAt),
      createdByName: actorFullName,
    })
    const certificateUpload = await this.documentsService.uploadDirect(
      actor,
      REG_RETENTION_RECORD_TYPE,
      retentionId,
      { buffer: certificateBuffer, originalname: `retention-certificate-${displayCode}.pdf`, mimetype: 'application/pdf' },
      { title: 'Retention Certificate' },
      meta,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.regRetention.create({
        data: {
          id: retentionId,
          companyId,
          productRegistrationId: registration.id,
          displayCode,
          year: dto.year,
          invoiceDocumentId: invoiceUpload.document.id,
          proofOfPaymentDocumentId: proofOfPaymentUpload.document.id,
          certificateDocumentId: certificateUpload.document.id,
          status: 'certified',
          paidAt: new Date(dto.paidAt),
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'reg_retention_certified',
        recordType: REGISTRATION_RECORD_TYPE,
        recordId: registration.id,
        newValue: {
          retentionId: created.id,
          displayCode,
          year: dto.year,
          invoiceDocumentId: invoiceUpload.document.id,
          proofOfPaymentDocumentId: proofOfPaymentUpload.document.id,
          certificateDocumentId: certificateUpload.document.id,
        },
        ip: meta.ip,
      })

      return created
    })
  }
}
