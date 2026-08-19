import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { CallLog } from '@prisma/client'

import { isAfterHoursOrWeekend } from '../../common/after-hours.util'
import { TextEncryptionService } from '../../common/encryption/text-encryption.service'
import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { ListCallLogsQueryDto } from './dto/list-call-logs-query.dto'
import { LogCallDto } from './dto/log-call.dto'
import { PvCaseService, RequestMeta } from './pv-case.service'

/** `CallLog` with its encrypted field replaced by the real decrypted value, plus the live-computed after-hours flag (Stage 21). */
export type CallLogWithDecrypted = Omit<CallLog, 'transcriptionNoteEncrypted'> & {
  transcriptionNote: string | null
  isAfterHours: boolean
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Call logs are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * VigiCloud Stage 3.5 (+ Stage 21) — a CRM-style action log for a phone/
 * hotline report; see `CallLog`'s own schema doc comment for why this
 * only ever records what a staff member manually typed up, no live
 * telephony integration. When `dto.case` is present, the case is
 * created through the exact same `PvCaseService.create()` path the web
 * form uses (`channel` forced to `hotline_phone`), inside the *same*
 * transaction as the `CallLog` row itself — `RlsService.runAsCompany()`
 * nested calls transparently reuse the already-open transaction, so a
 * failure creating either half rolls back both rather than leaving an
 * orphan case with no call log pointing at it.
 *
 * Stage 21 extends this same log for missed calls/voicemails:
 * `isVoicemail`/`audioDocumentId`/`transcriptionNoteEncrypted` — a
 * voicemail is functionally the same CRM-style act through the same
 * channel, not a new intake path, matching this table's own established
 * framing.
 */
@Injectable()
export class CallLogService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly pvCaseService: PvCaseService,
    private readonly textEncryption: TextEncryptionService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    dto: LogCallDto,
    meta: RequestMeta,
  ): Promise<CallLogWithDecrypted> {
    const companyId = requireCompany(actor)

    if (dto.outcome === 'case_created' && !dto.case) {
      throw new BadRequestException({
        code: 'CASE_REQUIRED',
        message: 'A call logged as "case_created" must include the case details',
      })
    }
    if (dto.outcome !== 'case_created' && dto.case) {
      throw new BadRequestException({
        code: 'UNEXPECTED_CASE',
        message: 'Case details are only accepted when outcome is "case_created"',
      })
    }

    return this.rls.runAsCompany(companyId, async (tx) => {
      let caseId: string | null = null
      if (dto.case) {
        const created = await this.pvCaseService.create(
          actor,
          { ...dto.case, channel: 'hotline_phone' },
          meta,
        )
        caseId = created.id
      }

      if (dto.audioDocumentId) {
        const audioDocument = await tx.document.findFirst({
          where: { id: dto.audioDocumentId, companyId },
        })
        if (!audioDocument) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: 'Audio document not found for this company',
          })
        }
      }

      const callLog = await tx.callLog.create({
        data: {
          id: newId(),
          companyId,
          callerNumber: dto.callerNumber,
          occurredAt: new Date(dto.occurredAt),
          durationSeconds: dto.durationSeconds ?? null,
          outcome: dto.outcome,
          notes: dto.notes ?? null,
          caseId,
          loggedBy: actor.sub,
          isVoicemail: dto.isVoicemail ?? false,
          audioDocumentId: dto.audioDocumentId ?? null,
          transcriptionNoteEncrypted: dto.transcriptionNote
            ? this.textEncryption.encrypt(dto.transcriptionNote)
            : null,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'pv_call_logged',
        recordType: 'pv_call_log',
        recordId: callLog.id,
        newValue: {
          callerNumber: dto.callerNumber,
          outcome: dto.outcome,
          caseId,
          isVoicemail: callLog.isVoicemail,
        },
        ip: meta.ip,
      })

      return this.decrypt(callLog)
    })
  }

  async list(
    actor: AuthenticatedUser,
    query: ListCallLogsQueryDto,
  ): Promise<PaginatedResult<CallLogWithDecrypted>> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = {
        companyId,
        ...(query.search
          ? { callerNumber: { contains: query.search, mode: 'insensitive' as const } }
          : {}),
      }

      const [rows, total] = await Promise.all([
        tx.callLog.findMany({
          where,
          orderBy: { occurredAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.callLog.count({ where }),
      ])

      return paginate(
        rows.map((r) => this.decrypt(r)),
        total,
        query,
      )
    })
  }

  private decrypt(row: CallLog): CallLogWithDecrypted {
    const { transcriptionNoteEncrypted, ...rest } = row
    return {
      ...rest,
      transcriptionNote: transcriptionNoteEncrypted
        ? this.textEncryption.decrypt(transcriptionNoteEncrypted)
        : null,
      isAfterHours: isAfterHoursOrWeekend(row.occurredAt),
    }
  }
}
