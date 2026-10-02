import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { DocumentAcknowledgment } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { AssignReadersDto } from './dto/assign-readers.dto'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Document acknowledgments are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 1 — the "assign a document to a reader,
 * track if they acknowledged it" consumer the `DocumentAcknowledgment`
 * model (Stage 0.2) has been waiting for. Deliberately the *reverse* gate
 * from what a naive reading suggests: a document going `effective` never
 * waits on anyone having read it yet (`Sop`'s own workflow has no such
 * guard) — only the reverse holds, and even that isn't enforced here as
 * a hard block: failing to acknowledge within `Sop.acknowledgmentWindowDays`
 * becomes a training-compliance finding (Stage 12's own job), this
 * service only tracks assignment/acknowledgment/overdue-ness honestly.
 */
@Injectable()
export class DocumentAcknowledgmentService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async assignReaders(
    actor: AuthenticatedUser,
    sopId: string,
    dto: AssignReadersDto,
    meta: RequestMeta,
  ): Promise<DocumentAcknowledgment[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const sop = await tx.sop.findFirst({ where: { id: sopId, companyId } })
      if (!sop)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Controlled document not found' })
      if (sop.status !== 'effective') {
        throw new ConflictException({
          code: 'NOT_EFFECTIVE',
          message: 'Readers can only be assigned once a controlled document is effective',
        })
      }

      const created: DocumentAcknowledgment[] = []
      for (const userId of dto.userIds) {
        const existing = await tx.documentAcknowledgment.findFirst({
          where: { sopId, userId, versionAcknowledged: sop.currentVersion },
        })
        if (existing) {
          created.push(existing)
          continue
        }
        const row = await tx.documentAcknowledgment.create({
          data: {
            id: newId(),
            companyId,
            sopId,
            userId,
            versionAcknowledged: sop.currentVersion,
          },
        })
        created.push(row)
      }

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'document_readers_assigned',
        recordType: 'sop',
        recordId: sopId,
        newValue: { userIds: dto.userIds, version: sop.currentVersion },
        ip: meta.ip,
      })

      return created
    })
  }

  async acknowledge(
    actor: AuthenticatedUser,
    sopId: string,
    meta: RequestMeta,
  ): Promise<DocumentAcknowledgment> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const sop = await tx.sop.findFirst({ where: { id: sopId, companyId } })
      if (!sop)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Controlled document not found' })

      const existing = await tx.documentAcknowledgment.findFirst({
        where: { sopId, userId: actor.sub, versionAcknowledged: sop.currentVersion },
      })
      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_ASSIGNED',
          message: 'You have not been assigned as a reader of this document version',
        })
      }
      if (existing.acknowledgedAt) return existing

      const updated = await tx.documentAcknowledgment.update({
        where: { id: existing.id },
        data: { acknowledgedAt: new Date() },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'document_acknowledged',
        recordType: 'sop',
        recordId: sopId,
        newValue: { version: sop.currentVersion },
        ip: meta.ip,
      })

      return updated
    })
  }

  async listForDocument(
    actor: AuthenticatedUser,
    sopId: string,
  ): Promise<(DocumentAcknowledgment & { overdue: boolean })[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const sop = await tx.sop.findFirst({ where: { id: sopId, companyId } })
      if (!sop)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Controlled document not found' })

      const rows = await tx.documentAcknowledgment.findMany({
        where: { sopId },
        orderBy: { assignedAt: 'asc' },
      })

      const windowMs = sop.acknowledgmentWindowDays * 24 * 60 * 60 * 1000
      const now = Date.now()
      return rows.map((row) => ({
        ...row,
        overdue: !row.acknowledgedAt && now - row.assignedAt.getTime() > windowMs,
      }))
    })
  }

  /** Every assignment across the company still outstanding past its own document's window — the literal "overdue" tracker widget. */
  async listOverdue(
    actor: AuthenticatedUser,
  ): Promise<(DocumentAcknowledgment & { sopTitle: string })[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const rows = await tx.documentAcknowledgment.findMany({
        where: { companyId, acknowledgedAt: null },
        include: { sop: { select: { title: true, acknowledgmentWindowDays: true } } },
        orderBy: { assignedAt: 'asc' },
      })
      const now = Date.now()
      return rows
        .filter(
          (row) =>
            now - row.assignedAt.getTime() > row.sop.acknowledgmentWindowDays * 24 * 60 * 60 * 1000,
        )
        .map(({ sop, ...row }) => ({ ...row, sopTitle: sop.title }))
    })
  }
}
