import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { RegQuery } from '@prisma/client'

import { TextEncryptionService } from '../../common/encryption/text-encryption.service'
import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { CreateRegQueryDto } from './dto/create-reg-query.dto'
import { EngagementModelService } from './engagement-model.service'
import { RegDeadlineService } from './reg-deadline.service'
import { REG_REGISTRATION_RECORD_TYPE } from './reg-dossier.service'

export interface RequestMeta {
  ip?: string
}

const REG_QUERY_RECORD_TYPE = 'reg_query'

export type RegQueryWithDecrypted = Omit<
  RegQuery,
  'queryTextEncrypted' | 'responseNoteEncrypted'
> & { queryText: string; responseNote: string | null }

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A query is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * RegCloud (Phase 12) Stage 5 — Query & Assessment. `receive()`/`respond()`
 * are real, standalone actions (not funneled through the generic
 * transition's `payload`, unlike Stage 6's approval) — a query's own
 * content is a genuinely independent, value-bearing artifact regardless
 * of whether the dossier's workflow later advances, the exact same
 * "create the artifact first, then gate the transition on its existence"
 * shape Stage 4's `RegSubmissionService.generate()` + evidence-gate
 * already established. `RegWorkflowGuards` is what actually checks "does
 * an open query exist" / "is the latest query closed" before letting
 * `→ query_received` / `→ resubmitted_for_review` through — this service
 * only ever creates/updates the record those guards check.
 */
@Injectable()
export class RegQueryService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
    private readonly encryptionService: TextEncryptionService,
    private readonly regDeadlineService: RegDeadlineService,
    private readonly engagementModelService: EngagementModelService,
  ) {}

  async list(actor: AuthenticatedUser, dossierId: string): Promise<RegQueryWithDecrypted[]> {
    const companyId = requireCompany(actor)
    const rows = await this.rls.runAsCompany(companyId, (tx) =>
      tx.regQuery.findMany({
        where: { companyId, regDossierId: dossierId },
        orderBy: { createdAt: 'desc' },
      }),
    )
    return rows.map((r) => this.decrypt(r))
  }

  async receive(
    actor: AuthenticatedUser,
    dossierId: string,
    dto: CreateRegQueryDto,
    meta: RequestMeta,
  ): Promise<RegQueryWithDecrypted> {
    const companyId = requireCompany(actor)

    const created = await this.rls.runAsCompany(companyId, async (tx) => {
      const dossier = await tx.regDossier.findFirst({
        where: { id: dossierId, companyId },
        include: { authority: true },
      })
      if (!dossier) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Dossier not found' })

      const receivedDate = dto.receivedDate ? new Date(dto.receivedDate) : new Date()
      const row = await tx.regQuery.create({
        data: {
          id: newId(),
          companyId,
          regDossierId: dossierId,
          receivedDate,
          queryTextEncrypted: this.encryptionService.encrypt(dto.queryText),
          status: 'open',
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'reg_query_received',
        recordType: REG_REGISTRATION_RECORD_TYPE,
        recordId: dossierId,
        newValue: { queryId: row.id, receivedDate: receivedDate.toISOString() },
        ip: meta.ip,
      })

      // Stage 0.4's deadline engine, reused exactly like Stage 0.4 itself
      // established — gracefully null (no error, no block) since Kenya's
      // real PRIMS turnaround is genuinely unverified/unseeded-as-active
      // (see `seedRegCloudFoundation()`'s own doc comment).
      await this.regDeadlineService.computeOrRecompute({
        companyId,
        recordType: 'reg_query_response',
        recordId: row.id,
        countryId: dossier.authority.countryId,
        authorityId: dossier.authorityId,
        productClass: dossier.productClass,
        obligationType: 'query_response',
        triggerDate: receivedDate,
        actorUserId: actor.sub,
      })

      return row
    })

    return this.decrypt(created)
  }

  /**
   * `file` is optional — required for every engagement type except
   * RegCloud Stage 15's `client_handles_queries` (the client fields
   * regulator questions directly, and may never share the actual
   * correspondence back with SafeMeds), in which case `note` becomes
   * required instead, encrypted into `responseNoteEncrypted`. Exactly
   * one of `responseDocumentId`/`responseNoteEncrypted` is ever set —
   * never both, never neither, once a query is closed.
   */
  async respond(
    actor: AuthenticatedUser,
    dossierId: string,
    queryId: string,
    file: DirectUploadFile | null,
    note: string | undefined,
    meta: RequestMeta,
  ): Promise<RegQueryWithDecrypted> {
    const companyId = requireCompany(actor)

    const query = await this.rls.runAsCompany(companyId, (tx) =>
      tx.regQuery.findFirst({ where: { id: queryId, regDossierId: dossierId, companyId } }),
    )
    if (!query) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Query not found' })
    if (query.status === 'closed') {
      throw new ConflictException({
        code: 'ALREADY_RESPONDED',
        message: 'This query already has a recorded response',
      })
    }

    let responseDocumentId: string | undefined
    if (file) {
      const upload = await this.documentsService.uploadDirect(
        actor,
        REG_QUERY_RECORD_TYPE,
        queryId,
        file,
        { title: 'Query Response' },
        meta,
      )
      responseDocumentId = upload.document.id
    } else {
      const effective = await this.rls.runAsCompany(companyId, (tx) =>
        this.engagementModelService.resolveEffective(tx, companyId, dossierId),
      )
      if (effective !== 'client_handles_queries') {
        throw new BadRequestException({
          code: 'RESPONSE_DOCUMENT_REQUIRED',
          message: 'A response document is required to close this query.',
        })
      }
      if (!note || note.trim().length === 0) {
        throw new BadRequestException({
          code: 'RESPONSE_NOTE_REQUIRED',
          message:
            'This dossier is engaged as "client handles queries" — describe how the client resolved this with the regulator, since no response document is being attached.',
        })
      }
    }

    const updated = await this.rls.runAsCompany(companyId, async (tx) => {
      const row = await tx.regQuery.update({
        where: { id: queryId },
        data: {
          responseDocumentId,
          responseNoteEncrypted: responseDocumentId
            ? undefined
            : this.encryptionService.encrypt(note!),
          respondedAt: new Date(),
          respondedBy: actor.sub,
          status: 'closed',
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'reg_query_responded',
        recordType: REG_REGISTRATION_RECORD_TYPE,
        recordId: dossierId,
        newValue: {
          queryId,
          responseDocumentId: responseDocumentId ?? null,
          respondedWithNoteOnly: !responseDocumentId,
        },
        ip: meta.ip,
      })

      return row
    })

    return this.decrypt(updated)
  }

  private decrypt(query: RegQuery): RegQueryWithDecrypted {
    const { queryTextEncrypted, responseNoteEncrypted, ...rest } = query
    return {
      ...rest,
      queryText: this.encryptionService.decrypt(queryTextEncrypted),
      responseNote: responseNoteEncrypted
        ? this.encryptionService.decrypt(responseNoteEncrypted)
        : null,
    }
  }
}
