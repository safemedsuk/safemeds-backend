import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { QppvNomination } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { SetQppvNominationDto } from './dto/set-qppv-nomination.dto'
import { UploadRegulatorConfirmationDto } from './dto/upload-regulator-confirmation.dto'
import { QppvNominationPdfService } from './qppv-nomination-pdf.service'

export interface RequestMeta {
  ip?: string
}

export const QPPV_NOMINATION_RECORD_TYPE = 'qppv_nomination'

export interface QppvStatus {
  primaryQppvUserId: string | null
  backupQppvUserId: string | null
  nominations: QppvNomination[]
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'QPPV nomination is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * VigiCloud Stage 16.4 — sets `Company.primaryQppvUserId`/
 * `backupQppvUserId` (the live current-state pointers) and, in the same
 * transaction-adjacent flow, generates a real nomination-letter PDF
 * through the normal Documents/R2 pipeline. A backup QPPV is legally
 * mandatory per GUD/006 §3 — see `QppvNomination`'s own schema doc
 * comment for the one requirement (Kenya residency) this service
 * genuinely cannot enforce, since `User` has no residency field.
 */
@Injectable()
export class QppvNominationService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
    private readonly pdfService: QppvNominationPdfService,
  ) {}

  async setNomination(
    actor: AuthenticatedUser,
    dto: SetQppvNominationDto,
    meta: RequestMeta,
  ): Promise<QppvNomination> {
    const companyId = requireCompany(actor)

    const { company, qppvUser, counterpart } = await this.rls.runAsCompany(
      companyId,
      async (tx) => {
        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } })
        const qppvUser = await tx.user.findFirst({ where: { id: dto.qppvUserId, companyId } })
        if (!qppvUser) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: 'User not found in this company',
          })
        }
        if (!qppvUser.roleKeys.includes('QPPV')) {
          throw new BadRequestException({
            code: 'NOT_QPPV_ROLE',
            message: 'The nominated user must hold the QPPV role',
          })
        }
        if (dto.role === 'backup' && company.primaryQppvUserId === dto.qppvUserId) {
          throw new BadRequestException({
            code: 'SAME_PERSON',
            message: 'The backup QPPV must be a different person from the primary QPPV',
          })
        }
        if (dto.role === 'primary' && company.backupQppvUserId === dto.qppvUserId) {
          throw new BadRequestException({
            code: 'SAME_PERSON',
            message: 'The primary QPPV must be a different person from the backup QPPV',
          })
        }

        // Real-usage feedback, 19 Aug 2026 — the real sample template names
        // both roles in one letter; the already-appointed *other* role (if
        // any) is looked up here so each letter can reference it, matching
        // that template's own §4 structure — see the PDF service's own doc
        // comment for why this doesn't change when a letter gets generated.
        const counterpartUserId =
          dto.role === 'primary' ? company.backupQppvUserId : company.primaryQppvUserId
        const counterpartUser = counterpartUserId
          ? await tx.user.findFirst({ where: { id: counterpartUserId, companyId } })
          : null

        return {
          company,
          qppvUser,
          counterpart: counterpartUser
            ? { fullName: counterpartUser.fullName, email: counterpartUser.email }
            : null,
        }
      },
    )

    const nominatedAt = new Date()
    const pdf = await this.pdfService.render({
      companyName: company.name,
      registeredAddress: company.registeredAddress,
      regulatoryContactEmail: company.regulatoryContactEmail,
      qppvFullName: qppvUser.fullName,
      qppvEmail: qppvUser.email,
      role: dto.role,
      nominatedAt,
      counterpart,
    })

    const nominationId = newId()
    const letterFile: DirectUploadFile = {
      buffer: pdf,
      originalname: `${dto.role}-qppv-nomination-letter.pdf`,
      mimetype: 'application/pdf',
    }
    const letterUpload = await this.documentsService.uploadDirect(
      actor,
      QPPV_NOMINATION_RECORD_TYPE,
      nominationId,
      letterFile,
      { title: 'QPPV Nomination Letter' },
      meta,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const previousActive = await tx.qppvNomination.findFirst({
        where: { companyId, role: dto.role, status: 'active' },
      })
      if (previousActive) {
        await tx.qppvNomination.update({
          where: { id: previousActive.id },
          data: { status: 'superseded', supersededAt: new Date() },
        })
      }

      const created = await tx.qppvNomination.create({
        data: {
          id: nominationId,
          companyId,
          qppvUserId: dto.qppvUserId,
          role: dto.role,
          nominationLetterDocumentId: letterUpload.document.id,
          nominatedAt,
          createdBy: actor.sub,
        },
      })

      await tx.company.update({
        where: { id: companyId },
        data:
          dto.role === 'primary'
            ? { primaryQppvUserId: dto.qppvUserId }
            : { backupQppvUserId: dto.qppvUserId },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'qppv_nomination_set',
        recordType: QPPV_NOMINATION_RECORD_TYPE,
        recordId: created.id,
        oldValue: previousActive ? { previousQppvUserId: previousActive.qppvUserId } : undefined,
        newValue: { role: dto.role, qppvUserId: dto.qppvUserId },
        ip: meta.ip,
      })

      return created
    })
  }

  async uploadRegulatorConfirmation(
    actor: AuthenticatedUser,
    nominationId: string,
    dto: UploadRegulatorConfirmationDto,
    meta: RequestMeta,
  ): Promise<QppvNomination> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const nomination = await tx.qppvNomination.findFirst({
        where: { id: nominationId, companyId },
      })
      if (!nomination) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Nomination not found' })
      }
      const document = await tx.document.findFirst({ where: { id: dto.documentId, companyId } })
      if (!document) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Document not found for this company',
        })
      }

      const updated = await tx.qppvNomination.update({
        where: { id: nominationId },
        data: { regulatorConfirmationDocumentId: dto.documentId },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'qppv_regulator_confirmation_uploaded',
        recordType: QPPV_NOMINATION_RECORD_TYPE,
        recordId: nominationId,
        newValue: { documentId: dto.documentId },
        ip: meta.ip,
      })

      return updated
    })
  }

  async getStatus(actor: AuthenticatedUser): Promise<QppvStatus> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { primaryQppvUserId: true, backupQppvUserId: true },
      })
      const nominations = await tx.qppvNomination.findMany({
        where: { companyId },
        orderBy: { nominatedAt: 'desc' },
      })
      return {
        primaryQppvUserId: company.primaryQppvUserId,
        backupQppvUserId: company.backupQppvUserId,
        nominations,
      }
    })
  }
}
