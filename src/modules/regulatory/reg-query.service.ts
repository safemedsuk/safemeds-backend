import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { RegQuery, RegQueryCorrespondence } from '@prisma/client'

import { TextEncryptionService } from '../../common/encryption/text-encryption.service'
import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { NotificationsService } from '../notifications/notifications.service'
import { TasksService } from '../tasks/tasks.service'
import { CloseRegQueryDto } from './dto/close-reg-query.dto'
import { CreateRegQueryDto } from './dto/create-reg-query.dto'
import { ListRegQueriesQueryDto } from './dto/list-reg-queries-query.dto'
import { LogRegQueryCorrespondenceDto } from './dto/log-reg-query-correspondence.dto'
import { AssignRegQueryOwnerDto, UpdateRegQueryDueDateDto } from './dto/update-reg-query.dto'
import { EngagementModelService } from './engagement-model.service'
import { RegDeadlineService } from './reg-deadline.service'
import { REG_REGISTRATION_RECORD_TYPE } from './reg-dossier.service'

export interface RequestMeta {
  ip?: string
}

export const REG_QUERY_RECORD_TYPE = 'reg_query'

/**
 * CEO feedback, 30 Sep 2026 — the register's own five states: `open`
 * (received, untouched), `in_progress` (owner assigned or activity
 * logged), `responded` (a response was recorded — `respond()`), `closed`
 * (a deliberate, later, formal filing-away — `close()`, only reachable
 * from `responded`). `overdue` is never one of these — it's a live
 * overlay (`isOverdue`, computed at read time from `responseDueDate` vs.
 * `status`), matching `TrainingRecord.computedStatus`'s own "never
 * store what can be derived" precedent, since the exact same row is
 * "open" or "overdue" depending purely on the clock, not on any action
 * anyone took.
 */
export const REG_QUERY_STATUSES = ['open', 'in_progress', 'responded', 'closed'] as const
export type RegQueryStatus = (typeof REG_QUERY_STATUSES)[number]
const OPEN_STATUSES: RegQueryStatus[] = ['open', 'in_progress']

export type RegQueryWithDecrypted = Omit<
  RegQuery,
  'queryTextEncrypted' | 'responseNoteEncrypted'
> & { queryText: string; responseNote: string | null; isOverdue: boolean }

export type RegQueryCorrespondenceWithDecrypted = Omit<
  RegQueryCorrespondence,
  'summaryEncrypted'
> & { summary: string }

export interface RegQueryRegisterRow extends RegQueryWithDecrypted {
  productBrandName: string
  countryId: string
  countryName: string
  ownerName: string | null
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A query is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

function computeIsOverdue(status: string, responseDueDate: Date | null): boolean {
  if (!responseDueDate) return false
  if (!OPEN_STATUSES.includes(status as RegQueryStatus)) return false
  return responseDueDate.getTime() < Date.now()
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
 *
 * CEO feedback, 30 Sep 2026 (real-usage query-register review) — extended
 * with a real due date, named/reassignable ownership, a genuine
 * multi-round correspondence thread, a widened open→in_progress→
 * responded→closed lifecycle, and a cross-dossier register view. See
 * `RegQueryReminderService` for the reminder/escalation half.
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
    private readonly notificationsService: NotificationsService,
    private readonly tasksService: TasksService,
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

  /**
   * CEO feedback, 30 Sep 2026 — the register view: "all queries across
   * products and markets, filterable by market, product, owner and
   * status, with overdue queries highlighted." A genuinely new,
   * cross-dossier list — the pre-existing `list()` above stays scoped to
   * one dossier for the correspondence panel.
   */
  async registerList(
    actor: AuthenticatedUser,
    query: ListRegQueriesQueryDto,
  ): Promise<PaginatedResult<RegQueryRegisterRow>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = {
        companyId,
        ...(query.ownerUserId ? { ownerUserId: query.ownerUserId } : {}),
        ...(query.status ? { status: query.status } : {}),
        // "overdue" filtered here (not post-fetch, so pagination/total
        // stay correct) as the real DB-level equivalent of `isOverdue`'s
        // own live computation — open/in-progress, past its own due date.
        ...(query.overdueOnly
          ? { status: { in: OPEN_STATUSES }, responseDueDate: { lt: new Date() } }
          : {}),
        ...(query.productId || query.countryId
          ? {
              regDossier: {
                ...(query.productId ? { productId: query.productId } : {}),
                ...(query.countryId ? { authority: { countryId: query.countryId } } : {}),
              },
            }
          : {}),
      }
      const [rows, total] = await Promise.all([
        tx.regQuery.findMany({
          where,
          include: {
            regDossier: {
              select: {
                product: { select: { brandName: true } },
                authority: { select: { countryId: true, country: { select: { name: true } } } },
              },
            },
            owner: { select: { fullName: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.regQuery.count({ where }),
      ])

      const mapped: RegQueryRegisterRow[] = rows.map(({ regDossier, owner, ...q }) => ({
        ...this.decrypt(q),
        productBrandName: regDossier.product.brandName,
        countryId: regDossier.authority.countryId,
        countryName: regDossier.authority.country.name,
        ownerName: owner?.fullName ?? null,
      }))

      return paginate(mapped, total, query)
    })
  }

  /**
   * testing-correction-explanation.md §2.1 — `file` is the regulator's own
   * scanned query letter, now mandatory (uploaded in the same
   * `multipart/form-data` request as `queryText`/`receivedDate` — the
   * dossier already exists at this point, so no holding-pair upload trick
   * is needed, unlike a genuinely chicken-and-egg case).
   */
  async receive(
    actor: AuthenticatedUser,
    dossierId: string,
    dto: CreateRegQueryDto,
    file: DirectUploadFile,
    meta: RequestMeta,
  ): Promise<RegQueryWithDecrypted> {
    const companyId = requireCompany(actor)

    const dossier = await this.rls.runAsCompany(companyId, (tx) =>
      tx.regDossier.findFirst({ where: { id: dossierId, companyId }, include: { authority: true } }),
    )
    if (!dossier) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Dossier not found' })

    const queryId = newId()
    const upload = await this.documentsService.uploadDirect(
      actor,
      REG_QUERY_RECORD_TYPE,
      queryId,
      file,
      { title: 'Regulator Query Letter' },
      meta,
    )

    const created = await this.rls.runAsCompany(companyId, async (tx) => {
      const receivedDate = new Date(dto.receivedDate)
      const row = await tx.regQuery.create({
        data: {
          id: queryId,
          companyId,
          regDossierId: dossierId,
          receivedDate,
          queryTextEncrypted: this.encryptionService.encrypt(dto.queryText),
          queryLetterDocumentId: upload.document.id,
          status: 'open',
          responseDueDate: dto.responseDueDate ? new Date(dto.responseDueDate) : null,
          ownerUserId: dto.ownerUserId ?? null,
          createdBy: actor.sub,
        },
      })

      await tx.regQueryCorrespondence.create({
        data: {
          id: newId(),
          companyId,
          regQueryId: row.id,
          direction: 'from_regulator',
          channel: 'letter',
          occurredOn: receivedDate,
          summaryEncrypted: this.encryptionService.encrypt(dto.queryText),
          documentId: upload.document.id,
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'reg_query_received',
        recordType: REG_REGISTRATION_RECORD_TYPE,
        recordId: dossierId,
        newValue: {
          queryId: row.id,
          receivedDate: receivedDate.toISOString(),
          queryLetterDocumentId: upload.document.id,
          responseDueDate: dto.responseDueDate ?? null,
          ownerUserId: dto.ownerUserId ?? null,
        },
        ip: meta.ip,
      })

      // Stage 0.4's deadline engine, reused exactly like Stage 0.4 itself
      // established — gracefully null (no error, no block) since Kenya's
      // real PRIMS turnaround is genuinely unverified/unseeded-as-active
      // (see `seedRegCloudFoundation()`'s own doc comment). CEO feedback,
      // 30 Sep 2026 — "automatic deadlines from each country's rules can
      // follow once Robert confirms the timelines"; `responseDueDate`
      // stays the manually-entered field regardless, this is left wired
      // for whenever a real rule exists to read instead.
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

  /** CEO feedback, 30 Sep 2026 — the regulator's own stated deadline, set or corrected at any point in the query's life. */
  async updateDueDate(
    actor: AuthenticatedUser,
    dossierId: string,
    queryId: string,
    dto: UpdateRegQueryDueDateDto,
    meta: RequestMeta,
  ): Promise<RegQueryWithDecrypted> {
    const companyId = requireCompany(actor)
    const existing = await this.findQueryOrThrow(companyId, dossierId, queryId)

    const updated = await this.rls.runAsCompany(companyId, async (tx) => {
      const row = await tx.regQuery.update({
        where: { id: queryId },
        data: { responseDueDate: new Date(dto.responseDueDate) },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'reg_query_due_date_set',
        recordType: REG_QUERY_RECORD_TYPE,
        recordId: queryId,
        oldValue: { responseDueDate: existing.responseDueDate?.toISOString() ?? null },
        newValue: { responseDueDate: dto.responseDueDate },
        ip: meta.ip,
      })
      return row
    })
    return this.decrypt(updated)
  }

  /** CEO feedback, 30 Sep 2026 — "assign each query to a named person, with the option to reassign." An `open` query moves to `in_progress` the moment it has a real owner — someone is now accountable for it. */
  async assignOwner(
    actor: AuthenticatedUser,
    dossierId: string,
    queryId: string,
    dto: AssignRegQueryOwnerDto,
    meta: RequestMeta,
  ): Promise<RegQueryWithDecrypted> {
    const companyId = requireCompany(actor)
    const existing = await this.findQueryOrThrow(companyId, dossierId, queryId)
    const ownerUserId = dto.ownerUserId ?? null

    if (ownerUserId) {
      const owner = await this.rls.runAsCompany(companyId, (tx) =>
        tx.user.findFirst({ where: { id: ownerUserId, companyId, status: 'active' } }),
      )
      if (!owner) {
        throw new BadRequestException({
          code: 'OWNER_NOT_FOUND',
          message: 'The named owner must be a real, active user in this company.',
        })
      }
    }

    const updated = await this.rls.runAsCompany(companyId, async (tx) => {
      const row = await tx.regQuery.update({
        where: { id: queryId },
        data: {
          ownerUserId,
          ...(ownerUserId && existing.status === 'open' ? { status: 'in_progress' } : {}),
        },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: existing.ownerUserId ? 'reg_query_reassigned' : 'reg_query_assigned',
        recordType: REG_QUERY_RECORD_TYPE,
        recordId: queryId,
        oldValue: { ownerUserId: existing.ownerUserId },
        newValue: { ownerUserId },
        ip: meta.ip,
      })
      return row
    })

    if (ownerUserId) {
      await this.notificationsService.create({
        companyId,
        userId: ownerUserId,
        category: 'workflow_update',
        title: 'A regulator query was assigned to you',
        body: `You've been made the owner of a regulator query. ${
          updated.responseDueDate
            ? `The regulator's stated deadline is ${updated.responseDueDate.toISOString().slice(0, 10)}.`
            : 'No response due date has been recorded yet.'
        }`,
        recordType: REG_QUERY_RECORD_TYPE,
        recordId: queryId,
      })
    }

    return this.decrypt(updated)
  }

  /**
   * CEO feedback, 30 Sep 2026 — "every letter, email and document
   * exchanged on a query kept in one thread, with dates, including
   * follow-up questions and multiple response rounds." Logging any
   * correspondence naturally advances a still-`open` query to
   * `in_progress` — real activity is happening on it.
   */
  async addCorrespondence(
    actor: AuthenticatedUser,
    dossierId: string,
    queryId: string,
    dto: LogRegQueryCorrespondenceDto,
    file: DirectUploadFile | null,
    meta: RequestMeta,
  ): Promise<RegQueryCorrespondenceWithDecrypted> {
    const companyId = requireCompany(actor)
    const existing = await this.findQueryOrThrow(companyId, dossierId, queryId)

    let documentId: string | undefined
    if (file) {
      const upload = await this.documentsService.uploadDirect(
        actor,
        REG_QUERY_RECORD_TYPE,
        queryId,
        file,
        { title: `Query correspondence — ${dto.channel}` },
        meta,
      )
      documentId = upload.document.id
    }

    const created = await this.rls.runAsCompany(companyId, async (tx) => {
      const row = await tx.regQueryCorrespondence.create({
        data: {
          id: newId(),
          companyId,
          regQueryId: queryId,
          direction: dto.direction,
          channel: dto.channel,
          occurredOn: new Date(dto.occurredOn),
          summaryEncrypted: this.encryptionService.encrypt(dto.summary),
          documentId,
          createdBy: actor.sub,
        },
      })

      if (existing.status === 'open') {
        await tx.regQuery.update({ where: { id: queryId }, data: { status: 'in_progress' } })
      }

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'reg_query_correspondence_logged',
        recordType: REG_QUERY_RECORD_TYPE,
        recordId: queryId,
        newValue: {
          correspondenceId: row.id,
          direction: dto.direction,
          channel: dto.channel,
          occurredOn: dto.occurredOn,
          documentId: documentId ?? null,
        },
        ip: meta.ip,
      })

      return row
    })

    const { summaryEncrypted, ...rest } = created
    return { ...rest, summary: this.encryptionService.decrypt(summaryEncrypted) }
  }

  async listCorrespondence(
    actor: AuthenticatedUser,
    dossierId: string,
    queryId: string,
  ): Promise<RegQueryCorrespondenceWithDecrypted[]> {
    const companyId = requireCompany(actor)
    await this.findQueryOrThrow(companyId, dossierId, queryId)
    const rows = await this.rls.runAsCompany(companyId, (tx) =>
      tx.regQueryCorrespondence.findMany({
        where: { companyId, regQueryId: queryId },
        orderBy: { occurredOn: 'asc' },
      }),
    )
    return rows.map(({ summaryEncrypted, ...rest }) => ({
      ...rest,
      summary: this.encryptionService.decrypt(summaryEncrypted),
    }))
  }

  /**
   * testing-correction-explanation.md §2.1 — `note` and `respondedDate`
   * are now always required, for every engagement type (a real
   * description of the response and the real date it was sent, alongside
   * whatever document is attached). `file` stays optional only for
   * RegCloud Stage 15's `client_handles_queries` (the client fields
   * regulator questions directly, and may never share the actual
   * correspondence back with SafeMeds) — every other engagement type
   * still requires it. `responseNoteEncrypted` is stored regardless of
   * whether a document is also present, a genuine widening from its
   * previous "only when there's no document" role.
   *
   * CEO feedback, 30 Sep 2026 — this now lands the query at `responded`,
   * not `closed` (the two are distinct states in the real register — see
   * `REG_QUERY_STATUSES`'s own doc comment); `close()` is the separate,
   * later, formal filing-away step. The dossier-workflow guards
   * (`reg-workflow-guards.service.ts`) were updated in lockstep to accept
   * either state.
   */
  async respond(
    actor: AuthenticatedUser,
    dossierId: string,
    queryId: string,
    file: DirectUploadFile | null,
    note: string,
    respondedDate: string,
    meta: RequestMeta,
  ): Promise<RegQueryWithDecrypted> {
    const companyId = requireCompany(actor)

    const query = await this.rls.runAsCompany(companyId, (tx) =>
      tx.regQuery.findFirst({ where: { id: queryId, regDossierId: dossierId, companyId } }),
    )
    if (!query) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Query not found' })
    if (query.status === 'responded' || query.status === 'closed') {
      throw new ConflictException({
        code: 'ALREADY_RESPONDED',
        message: 'This query already has a recorded response',
      })
    }
    if (!note || note.trim().length === 0) {
      throw new BadRequestException({
        code: 'RESPONSE_NOTE_REQUIRED',
        message: 'Describe how this query was resolved before closing it.',
      })
    }
    if (!respondedDate || Number.isNaN(new Date(respondedDate).getTime())) {
      throw new BadRequestException({
        code: 'RESPONDED_DATE_REQUIRED',
        message: 'The real date this response was sent to the regulator is required.',
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
    }

    const updated = await this.rls.runAsCompany(companyId, async (tx) => {
      const row = await tx.regQuery.update({
        where: { id: queryId },
        data: {
          responseDocumentId,
          responseNoteEncrypted: this.encryptionService.encrypt(note),
          respondedDate: new Date(respondedDate),
          respondedAt: new Date(),
          respondedBy: actor.sub,
          status: 'responded',
        },
      })

      await tx.regQueryCorrespondence.create({
        data: {
          id: newId(),
          companyId,
          regQueryId: queryId,
          direction: 'to_regulator',
          channel: responseDocumentId ? 'letter' : 'note',
          occurredOn: new Date(respondedDate),
          summaryEncrypted: this.encryptionService.encrypt(note),
          documentId: responseDocumentId,
          createdBy: actor.sub,
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
          respondedDate,
          respondedWithNoteOnly: !responseDocumentId,
        },
        ip: meta.ip,
      })

      return row
    })

    return this.decrypt(updated)
  }

  /** CEO feedback, 30 Sep 2026 — the register's own separate, deliberate "closed" state, reachable only once a response is on file. */
  async close(
    actor: AuthenticatedUser,
    dossierId: string,
    queryId: string,
    dto: CloseRegQueryDto,
    meta: RequestMeta,
  ): Promise<RegQueryWithDecrypted> {
    const companyId = requireCompany(actor)
    const existing = await this.findQueryOrThrow(companyId, dossierId, queryId)

    if (existing.status === 'closed') {
      throw new ConflictException({ code: 'ALREADY_CLOSED', message: 'This query is already closed' })
    }
    if (existing.status !== 'responded') {
      throw new ConflictException({
        code: 'MUST_RESPOND_FIRST',
        message: 'Record a response before closing this query.',
      })
    }

    const updated = await this.rls.runAsCompany(companyId, async (tx) => {
      const row = await tx.regQuery.update({
        where: { id: queryId },
        data: { status: 'closed', closedAt: new Date(), closedBy: actor.sub },
      })
      if (dto.note) {
        await tx.regQueryCorrespondence.create({
          data: {
            id: newId(),
            companyId,
            regQueryId: queryId,
            direction: 'internal_note',
            channel: 'note',
            occurredOn: new Date(),
            summaryEncrypted: this.encryptionService.encrypt(dto.note),
            createdBy: actor.sub,
          },
        })
      }
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'reg_query_closed',
        recordType: REG_QUERY_RECORD_TYPE,
        recordId: queryId,
        newValue: { note: dto.note ?? null },
        ip: meta.ip,
      })
      return row
    })

    // Closes out any overdue-escalation task the reminder scan raised for this query.
    await this.tasksService.closeOpenForRecord(companyId, REG_QUERY_RECORD_TYPE, queryId, meta)

    return this.decrypt(updated)
  }

  private async findQueryOrThrow(companyId: string, dossierId: string, queryId: string) {
    const query = await this.rls.runAsCompany(companyId, (tx) =>
      tx.regQuery.findFirst({ where: { id: queryId, regDossierId: dossierId, companyId } }),
    )
    if (!query) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Query not found' })
    return query
  }

  private decrypt(query: RegQuery): RegQueryWithDecrypted {
    const { queryTextEncrypted, responseNoteEncrypted, ...rest } = query
    return {
      ...rest,
      queryText: this.encryptionService.decrypt(queryTextEncrypted),
      responseNote: responseNoteEncrypted
        ? this.encryptionService.decrypt(responseNoteEncrypted)
        : null,
      isOverdue: computeIsOverdue(query.status, query.responseDueDate),
    }
  }
}
