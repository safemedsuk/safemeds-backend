import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ContactTest, ContactTestAttempt, ContactTestStatus, Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult, PaginationQueryDto } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { addWindowDays } from '../workflow/deadline-date.util'
import { LogContactTestAttemptDto } from './dto/log-contact-test-attempt.dto'
import { StartContactTestDto } from './dto/start-contact-test.dto'

export interface RequestMeta {
  ip?: string
}

export const CONTACT_TEST_RECORD_TYPE = 'contact_test'

/** The user's own note: "5 day testing for emails and for calls immediately." Calendar days — no "working days" qualifier given, unlike Stage 11's own explicit "five working days" wording. */
const EMAIL_WINDOW_CALENDAR_DAYS = 5

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Contact tests are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

function windowFor(channel: 'email' | 'phone', from: Date): Date {
  return channel === 'email' ? addWindowDays(from, EMAIL_WINDOW_CALENDAR_DAYS, 'calendar') : from
}

/**
 * VigiCloud Stage 15.2 — tests whether a contact channel is reachable at
 * all, independent of any one case. Two-trigger retry, per the user's
 * own note: "Followup trigger 1 and followup trigger 2. If one goes
 * through then good and dusted else we try a second time and it is now
 * rejected if it still failed or accepted if the 2nd triage passed."
 * Shares its retry shape with Stage 11's `CaseFollowUpService` but is
 * deliberately simpler — no consent gate (this tests a channel SafeMeds'
 * own tenant operates, e.g. their own QPPV hotline or drug-safety
 * mailbox, never an external reporter's own contact info, so Stage 11's
 * "don't contact someone without consent" reasoning doesn't apply here).
 */
@Injectable()
export class ContactTestService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async start(
    actor: AuthenticatedUser,
    dto: StartContactTestDto,
    meta: RequestMeta,
  ): Promise<ContactTest> {
    const companyId = requireCompany(actor)
    const now = new Date()

    const created = await this.rls.runAsCompany(companyId, async (tx) => {
      const row = await tx.contactTest.create({
        data: {
          id: newId(),
          companyId,
          channel: dto.channel,
          contactValue: dto.contactValue,
          purpose: dto.purpose ?? null,
          status: 'pending_attempt_1',
          windowDueAt: windowFor(dto.channel, now),
          initiatedBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'contact_test_started',
        recordType: CONTACT_TEST_RECORD_TYPE,
        recordId: row.id,
        newValue: {
          channel: dto.channel,
          contactValue: dto.contactValue,
          purpose: dto.purpose ?? null,
        },
        ip: meta.ip,
      })

      return row
    })

    if (dto.channel === 'email') {
      await this.notificationsService.sendExternalEmail(
        dto.contactValue,
        'SafeMeds reachability test — please confirm receipt',
        `This is a routine test of this mailbox's reachability${dto.purpose ? ` (${dto.purpose})` : ''}. Please reply to confirm you received this message. No action is needed beyond a reply — this is not a safety report.`,
      )
    }

    return created
  }

  async logAttempt(
    actor: AuthenticatedUser,
    contactTestId: string,
    dto: LogContactTestAttemptDto,
    meta: RequestMeta,
  ): Promise<ContactTest> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const test = await tx.contactTest.findFirst({ where: { id: contactTestId, companyId } })
      if (!test) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Contact test not found' })
      }
      if (test.status === 'reached' || test.status === 'unsuccessful') {
        throw new ConflictException({
          code: 'CONTACT_TEST_ALREADY_RESOLVED',
          message: 'This contact test has already been resolved — start a new one instead',
        })
      }

      return this.settle(tx, companyId, test, dto.outcome, actor.sub, dto.note ?? null, meta)
    })
  }

  /** Shared by `logAttempt()` (a human logging what happened) and `processDue()` (a system-detected timeout, treated as an unlogged `no_response`) — both must reach the exact same state-machine outcome. */
  private async settle(
    tx: Prisma.TransactionClient,
    companyId: string,
    test: ContactTest,
    outcome: 'reached' | 'no_response',
    loggedBy: string | null,
    note: string | null,
    meta: RequestMeta,
  ): Promise<ContactTest> {
    const attemptNumber = test.status === 'pending_attempt_1' ? 1 : 2
    const now = new Date()

    await tx.contactTestAttempt.create({
      data: {
        id: newId(),
        companyId,
        contactTestId: test.id,
        attemptNumber,
        outcome,
        loggedBy,
        note,
      },
    })

    let nextStatus: ContactTestStatus
    let nextWindowDueAt = test.windowDueAt
    if (outcome === 'reached') {
      nextStatus = 'reached'
    } else if (test.status === 'pending_attempt_1') {
      nextStatus = 'pending_attempt_2'
      nextWindowDueAt = windowFor(test.channel, now)
    } else {
      nextStatus = 'unsuccessful'
    }

    const resolved = nextStatus === 'reached' || nextStatus === 'unsuccessful'
    const updated = await tx.contactTest.update({
      where: { id: test.id },
      data: {
        status: nextStatus,
        attemptCount: { increment: 1 },
        windowDueAt: nextWindowDueAt,
        resolvedAt: resolved ? now : null,
      },
    })

    await this.auditService.log(tx, {
      companyId,
      actorUserId: loggedBy ?? undefined,
      actorType: loggedBy ? 'user' : 'system',
      action: 'contact_test_attempt_logged',
      recordType: CONTACT_TEST_RECORD_TYPE,
      recordId: test.id,
      oldValue: { status: test.status },
      newValue: { status: nextStatus, attemptNumber, outcome },
      ip: meta.ip,
    })

    return updated
  }

  async list(
    actor: AuthenticatedUser,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<ContactTest>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = { companyId }
      const [rows, total] = await Promise.all([
        tx.contactTest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.contactTest.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<ContactTest & { attempts: ContactTestAttempt[] }> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.contactTest.findFirst({
        where: { id, companyId },
        include: { attempts: { orderBy: { occurredAt: 'asc' } } },
      })
      if (!found) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Contact test not found' })
      }
      return found
    })
  }

  /**
   * The daily sweep's own work: any test still pending whose window has
   * elapsed with nothing logged is treated exactly like a logged
   * `no_response` — silence past the window is itself the signal,
   * mirroring `CaseFollowUpProcessor`'s identical reasoning for an
   * unanswered follow-up attempt.
   */
  async processDue(): Promise<{ scanned: number; settled: number }> {
    const now = new Date()
    const due = await this.rls.runWithSystemAccess((tx) =>
      tx.contactTest.findMany({
        where: {
          status: { in: ['pending_attempt_1', 'pending_attempt_2'] },
          windowDueAt: { lt: now },
        },
      }),
    )

    let settled = 0
    for (const test of due) {
      await this.rls.runAsCompany(test.companyId, (tx) =>
        this.settle(
          tx,
          test.companyId,
          test,
          'no_response',
          null,
          'Window elapsed with no logged response.',
          {},
        ),
      )
      settled += 1
    }

    return { scanned: due.length, settled }
  }
}
