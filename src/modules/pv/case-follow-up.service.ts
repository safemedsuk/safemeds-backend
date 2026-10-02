import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Case, CaseFollowUp, CaseFollowUpAttempt, DayType, Prisma, Reporter } from '@prisma/client'

import { TextEncryptionService } from '../../common/encryption/text-encryption.service'
import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { EnvConfig } from '../../config/env.validation'
import { AuditService } from '../audit/audit.service'
import { ConsentService } from '../consent/consent.service'
import { NotificationsService } from '../notifications/notifications.service'
import { TasksService } from '../tasks/tasks.service'
import { addWindowDays } from '../workflow/deadline-date.util'
import { LogFollowUpAttemptDto } from './dto/log-follow-up-attempt.dto'
import { PV_CASE_RECORD_TYPE, RequestMeta } from './pv-case.service'

/** Final doc §D, read directly: "Follow-up begins at intake, needs consent before contact, runs at least two attempts (email window five working days), and any new update resets the seven-day cycle; close within 28 days." */
const ATTEMPT_WINDOW_BUSINESS_DAYS = 5
const ATTEMPT_WINDOW_DAY_TYPE: DayType = 'business'
const RESET_CYCLE_CALENDAR_DAYS = 7
const HARD_CEILING_CALENDAR_DAYS = 28

/**
 * testing-todo Stage 11.1 — the fallback assignee for a follow-up task
 * when the case has no individual captor to hand it to (a system-channel
 * case — public URL/WhatsApp/email intake — has `Case.createdBy: null`
 * by design, see that column's own schema doc comment). Matches
 * `WorkflowService.openTaskForState()`'s own precedent for the Intake
 * state's task ownership — `SUPERINTENDENT_PHARMACIST` is already the
 * role this codebase treats as "responsible for this case" at Intake,
 * where a follow-up cycle always begins.
 */
const FOLLOW_UP_FALLBACK_ROLE_KEY = 'SUPERINTENDENT_PHARMACIST'

/** Every follow-up task's title starts with this, so it can be found and closed/replaced without a schema change — see `closeOpenFollowUpTasks()`. */
const FOLLOW_UP_TASK_TITLE_PREFIX = 'Follow-up'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'PV cases are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

type AttemptWithDecrypted = Omit<CaseFollowUpAttempt, 'noteEncrypted'> & { note: string | null }
export type CaseFollowUpWithAttempts = CaseFollowUp & { attempts: AttemptWithDecrypted[] }

/**
 * VigiCloud Stage 11 — built against the exact one-sentence spec text
 * above, which covers a multi-step state machine in a single sentence.
 * This is a deliberate, documented interpretation (see `CaseFollowUp`'s
 * own schema doc comment for the full reconciliation note), not the only
 * possible reading:
 *
 * - `closesByDate` is a **hard ceiling**, fixed at `start()` time and
 *   never moved — 28 calendar days after the cycle began, full stop.
 * - Each attempt gets its own 5-**working**-day window (`addWindowDays`,
 *   `'business'`) before the periodic job treats it as unanswered.
 * - A `responded_new_information` log **resets** the clock: the case gets
 *   a fresh 7-**calendar**-day check window from that moment
 *   (`nextCheckDueAt`), without ever pushing past `closesByDate`.
 * - Two attempts, no more: attempt 1 unanswered → attempt 2 fires
 *   automatically; attempt 2 unanswered → the case closes
 *   `closed_failed`. Either attempt answered with `responded_resolved`
 *   closes the case `closed_resolved` immediately.
 *
 * Consent is checked (`ConsentService`, `consentType: 'contact'`) before
 * every *automated* email attempt — never the manual phone-log action,
 * which is a human choosing to contact the reporter themselves, exactly
 * the kind of contact the guideline's consent gate exists to gate the
 * *system* from doing unprompted, not something to block a human from
 * doing on their own initiative once they're already on the phone.
 *
 * **testing-todo Stage 11.1 redesign (18 Aug 2026)**: real-usage
 * feedback correctly flagged that notifying every `pv.triage_case`-
 * holding user in the company (often, in practice, whoever happened to
 * also hold the SYSTEM_ADMINISTRATOR role) doesn't match who's actually
 * doing the work, gave no way to contact the reporter without opening
 * the case separately, and had no due-list a busy pharmacist could
 * actually work from. Fixed with `resolveHandler()`: the case's own
 * `createdBy` (the staff member who captured it) is now the primary,
 * sole recipient whenever one exists — a real handler, not a broadcast
 * — falling back to the pre-existing role-based fan-out only for
 * system-channel cases with no individual captor. Every notification
 * body now includes the reporter's own name/phone/email. And every
 * triggered attempt now opens (or refreshes) a real `Task` via
 * `TasksService`, so the due date shows up in Task Inbox and on the
 * case's own `RecordTasksPanel` — not just a notification easy to miss.
 */
@Injectable()
export class CaseFollowUpService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly consentService: ConsentService,
    private readonly notificationsService: NotificationsService,
    private readonly tasksService: TasksService,
    private readonly textEncryption: TextEncryptionService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  /** A staff member starting a follow-up cycle by hand. */
  async start(
    actor: AuthenticatedUser,
    caseId: string,
    meta: RequestMeta,
  ): Promise<CaseFollowUpWithAttempts> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      this.startInTx(tx, companyId, caseId, actor.sub, meta),
    )
  }

  /**
   * The periodic job's own trigger source — a case whose
   * `PregnancyContext.followUpDueAt` has come due gets its follow-up
   * cycle auto-started with no human actor, per this stage's own
   * cross-stage dependency note (Stage 3.1's `followUpDueAt` column sat
   * unused until this is the first thing to ever read it).
   */
  async startSystem(
    companyId: string,
    caseId: string,
    meta: RequestMeta,
  ): Promise<CaseFollowUpWithAttempts> {
    return this.rls.runAsCompany(companyId, (tx) =>
      this.startInTx(tx, companyId, caseId, null, meta),
    )
  }

  async get(actor: AuthenticatedUser, caseId: string): Promise<CaseFollowUpWithAttempts | null> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const followUp = await tx.caseFollowUp.findUnique({
        where: { caseId },
        include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
      })
      return followUp ? this.decryptAttempts(followUp) : null
    })
  }

  /**
   * The FE's "log a follow-up contact" action — resolves whichever
   * attempt is currently `pending` on this follow-up. Never creates a new
   * attempt row itself; it settles the one the system (or a prior call to
   * this same method) already opened.
   */
  async logAttempt(
    actor: AuthenticatedUser,
    followUpId: string,
    dto: LogFollowUpAttemptDto,
    meta: RequestMeta,
  ): Promise<CaseFollowUpWithAttempts> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const followUp = await tx.caseFollowUp.findFirst({
        where: { id: followUpId, companyId },
        include: { attempts: true },
      })
      if (!followUp) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Case follow-up not found' })
      }
      if (followUp.status === 'closed_resolved' || followUp.status === 'closed_failed') {
        throw new ConflictException({
          code: 'FOLLOW_UP_CLOSED',
          message: 'This follow-up cycle is already closed',
        })
      }

      const pendingAttempt = followUp.attempts.find((a) => a.outcome === 'pending')
      if (!pendingAttempt) {
        throw new ConflictException({
          code: 'NO_PENDING_ATTEMPT',
          message: 'There is no pending attempt to log against',
        })
      }

      if (dto.documentId) {
        const document = await tx.document.findFirst({
          where: { id: dto.documentId, companyId },
        })
        if (!document) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: 'Document not found for this company — upload it first via the documents endpoint',
          })
        }
      }

      await tx.caseFollowUpAttempt.update({
        where: { id: pendingAttempt.id },
        data: {
          outcome: dto.outcome,
          respondedAt: new Date(),
          loggedBy: actor.sub,
          noteEncrypted: dto.note ? this.textEncryption.encrypt(dto.note) : null,
          documentId: dto.documentId ?? null,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'pv_case_follow_up_attempt_logged',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: followUp.caseId,
        newValue: {
          followUpId: followUp.id,
          attemptNumber: pendingAttempt.attemptNumber,
          outcome: dto.outcome,
        },
        ip: meta.ip,
      })

      await this.settleOutcome(tx, companyId, followUp, pendingAttempt, dto.outcome, meta)

      const refreshed = await tx.caseFollowUp.findUniqueOrThrow({
        where: { id: followUp.id },
        include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
      })
      return this.decryptAttempts(refreshed)
    })
  }

  /**
   * The periodic sweep — scans every company's open follow-ups for a
   * pending attempt whose `dueAt` has passed with no response (treated
   * as an automatic `no_response`) and for any open follow-up whose
   * `closesByDate` has passed regardless of attempt state (the hard
   * ceiling always wins). Also the system trigger for
   * `PregnancyContext.followUpDueAt`. Mirrors
   * `DuplicateDetectionService.scanOpenCases()`'s exact per-company
   * `runWithSystemAccess` → `runAsCompany` shape.
   */
  async processDue(): Promise<{
    companiesScanned: number
    attemptsTimedOut: number
    hardClosed: number
    pregnancyTriggered: number
  }> {
    const companies = await this.rls.runWithSystemAccess((tx) =>
      tx.company.findMany({ where: { status: 'active' }, select: { id: true } }),
    )

    let attemptsTimedOut = 0
    let hardClosed = 0
    let pregnancyTriggered = 0
    const now = new Date()

    for (const company of companies) {
      await this.rls.runAsCompany(company.id, async (tx) => {
        const openFollowUps = await tx.caseFollowUp.findMany({
          where: {
            companyId: company.id,
            status: { in: ['pending_attempt_1', 'pending_attempt_2'] },
          },
          include: { attempts: true },
        })

        for (const followUp of openFollowUps) {
          if (followUp.closesByDate <= now) {
            await this.closeFollowUp(
              tx,
              company.id,
              followUp,
              'closed_failed',
              'Reached the 28-day hard ceiling with no resolution',
              { ip: undefined },
            )
            hardClosed += 1
            continue
          }

          const pendingAttempt = followUp.attempts.find((a) => a.outcome === 'pending')
          if (pendingAttempt && pendingAttempt.dueAt <= now) {
            await tx.caseFollowUpAttempt.update({
              where: { id: pendingAttempt.id },
              data: { outcome: 'no_response' },
            })
            await this.settleOutcome(tx, company.id, followUp, pendingAttempt, 'no_response', {
              ip: undefined,
            })
            attemptsTimedOut += 1
          }
        }

        // `startInTx()` is itself idempotent (a case that already has a
        // `CaseFollowUp` just returns it, unchanged) — that idempotency is
        // relied on here instead of a nested `case: { followUp: null }`
        // Prisma filter, keeping this query a plain single-table lookup.
        const duePregnancies = await tx.pregnancyContext.findMany({
          where: { companyId: company.id, followUpDueAt: { lte: now } },
          select: { caseId: true },
        })
        for (const p of duePregnancies) {
          const alreadyStarted = await tx.caseFollowUp.findUnique({ where: { caseId: p.caseId } })
          if (alreadyStarted) continue
          await this.startInTx(tx, company.id, p.caseId, null, { ip: undefined })
          pregnancyTriggered += 1
        }
      })
    }

    return { companiesScanned: companies.length, attemptsTimedOut, hardClosed, pregnancyTriggered }
  }

  private async startInTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    caseId: string,
    startedBy: string | null,
    meta: RequestMeta,
  ): Promise<CaseFollowUpWithAttempts> {
    const existing = await tx.caseFollowUp.findUnique({
      where: { caseId },
      include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
    })
    if (existing) return this.decryptAttempts(existing)

    const pvCase = await tx.case.findFirst({
      where: { id: caseId, companyId },
      include: { reporter: true },
    })
    if (!pvCase) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'PV case not found' })
    }

    const now = new Date()
    const followUp = await tx.caseFollowUp.create({
      data: {
        id: newId(),
        companyId,
        caseId,
        status: 'pending_attempt_1',
        cycleStartedAt: now,
        closesByDate: addWindowDays(now, HARD_CEILING_CALENDAR_DAYS, 'calendar'),
        startedBy,
      },
    })

    await this.auditService.log(tx, {
      companyId,
      ...(startedBy ? { actorUserId: startedBy } : { actorType: 'system' as const }),
      action: 'pv_case_follow_up_started',
      recordType: PV_CASE_RECORD_TYPE,
      recordId: caseId,
      newValue: { followUpId: followUp.id, closesByDate: followUp.closesByDate.toISOString() },
      ip: meta.ip,
    })

    await this.triggerAttempt(tx, companyId, followUp, pvCase, pvCase.reporter, 1, meta)

    const refreshed = await tx.caseFollowUp.findUniqueOrThrow({
      where: { id: followUp.id },
      include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
    })
    return this.decryptAttempts(refreshed)
  }

  /**
   * Opens a new attempt row and, only if `ConsentService` confirms
   * contact consent AND the reporter has an email on file, actually
   * queues the automated email (real reuse of the Phase 9
   * `NotificationsService.sendExternalEmail()` infrastructure). If
   * either is missing, the attempt still opens (with its own 5-working-
   * day window) but stays purely manual — the resolved handler is
   * expected to make phone contact and log it themselves. Also opens a
   * real due-list `Task` (Stage 11.1) — any stale prior follow-up task
   * on this case is closed first, so exactly one stays open at a time.
   */
  private async triggerAttempt(
    tx: Prisma.TransactionClient,
    companyId: string,
    followUp: CaseFollowUp,
    pvCase: Case,
    reporter: Reporter | null,
    attemptNumber: 1 | 2,
    meta: RequestMeta,
  ): Promise<void> {
    const now = new Date()
    const dueAt = addWindowDays(now, ATTEMPT_WINDOW_BUSINESS_DAYS, ATTEMPT_WINDOW_DAY_TYPE)

    const consent = await this.consentService.checkSystem(
      companyId,
      PV_CASE_RECORD_TYPE,
      pvCase.id,
      'contact',
    )
    const canEmail = consent.granted === true && !!reporter?.email

    await tx.caseFollowUpAttempt.create({
      data: {
        id: newId(),
        companyId,
        followUpId: followUp.id,
        attemptNumber,
        channel: canEmail ? 'email' : 'phone',
        outcome: 'pending',
        triggeredAt: now,
        dueAt,
      },
    })

    const appUrl = this.configService.get('FRONTEND_URL', { infer: true })
    const actionUrl = `${appUrl}/pv-cases/${pvCase.id}`
    const dueDateStr = dueAt.toISOString().slice(0, 10)
    const title = `${FOLLOW_UP_TASK_TITLE_PREFIX} ${attemptNumber} — case ${pvCase.referenceNumber} — due ${dueDateStr}`

    if (canEmail && reporter?.email) {
      await this.notificationsService.sendExternalEmail(
        reporter.email,
        `Follow-up on your safety report ${pvCase.referenceNumber}`,
        `We're following up on the report you submitted (reference ${pvCase.referenceNumber}). If you have any updates on the outcome, please reply to this email or contact us.`,
      )
    }

    const reporterContact = this.formatReporterContact(reporter)
    const handler = await this.resolveHandler(tx, companyId, pvCase.createdBy)

    await this.closeOpenFollowUpTasks(tx, companyId, pvCase.id, meta)
    await this.tasksService.createForWorkflowState(
      {
        companyId,
        recordType: PV_CASE_RECORD_TYPE,
        recordId: pvCase.id,
        title,
        ...handler.taskAssignment,
      },
      meta,
    )

    for (const recipient of handler.recipients) {
      await this.notificationsService.create({
        companyId,
        userId: recipient.id,
        category: 'case_follow_up',
        title,
        body: canEmail
          ? `Automated follow-up email ${attemptNumber} sent to the reporter for case ${pvCase.referenceNumber}. Reporter contact: ${reporterContact}. Due to respond by ${dueDateStr}.`
          : `Follow-up ${attemptNumber} for case ${pvCase.referenceNumber} needs manual contact — ${consent.granted !== true ? 'contact consent not on file' : 'no reporter email on file'}. Reporter contact: ${reporterContact}. Please contact by ${dueDateStr} and log the outcome.`,
        recordType: PV_CASE_RECORD_TYPE,
        recordId: pvCase.id,
        email: { to: recipient.email, actionUrl },
      })
    }

    await this.auditService.log(tx, {
      companyId,
      actorType: 'system',
      action: 'pv_case_follow_up_attempt_triggered',
      recordType: PV_CASE_RECORD_TYPE,
      recordId: pvCase.id,
      newValue: {
        followUpId: followUp.id,
        attemptNumber,
        channel: canEmail ? 'email' : 'phone',
        dueAt: dueAt.toISOString(),
      },
      ip: meta.ip,
    })
  }

  /**
   * Shared by both `logAttempt()` (a human resolving the pending attempt)
   * and `processDue()` (the periodic timeout path) — the state-machine
   * transition itself is identical either way.
   *
   * `responded_new_information` deliberately reopens the *same* attempt
   * row (outcome back to `pending`, `dueAt` pushed to the fresh 7-day
   * check point) rather than leaving it in a terminal state — the case is
   * still open and awaiting an eventual resolved/no-response outcome, so
   * a real bug found while browser-verifying this stage was that a
   * second "log a follow-up contact" after a first new-information log
   * had nothing left to attach to (`NO_PENDING_ATTEMPT`), even though the
   * cycle was obviously still active. The row's note/respondedAt are
   * overwritten on each subsequent log — the full history isn't lost,
   * every log is independently audited via `pv_case_follow_up_attempt_logged`.
   */
  private async settleOutcome(
    tx: Prisma.TransactionClient,
    companyId: string,
    followUp: CaseFollowUp,
    attempt: CaseFollowUpAttempt,
    outcome: 'responded_resolved' | 'responded_new_information' | 'no_response',
    meta: RequestMeta,
  ): Promise<void> {
    const pvCase = await tx.case.findFirstOrThrow({
      where: { id: followUp.caseId, companyId },
      include: { reporter: true },
    })
    const attemptNumber = attempt.attemptNumber as 1 | 2

    if (outcome === 'responded_resolved') {
      await this.closeFollowUp(
        tx,
        companyId,
        followUp,
        'closed_resolved',
        `Reporter responded on attempt ${attemptNumber}`,
        meta,
      )
      return
    }

    if (outcome === 'responded_new_information') {
      const now = new Date()
      const nextCheckDueAt = addWindowDays(now, RESET_CYCLE_CALENDAR_DAYS, 'calendar')

      await tx.caseFollowUp.update({
        where: { id: followUp.id },
        data: { lastResponseAt: now, nextCheckDueAt },
      })
      await tx.caseFollowUpAttempt.update({
        where: { id: attempt.id },
        data: { outcome: 'pending', dueAt: nextCheckDueAt },
      })

      // Real-usage request, 22 Sep 2026 (item 18) — new information from
      // the reporter means the case's own medical/causality assessment
      // may no longer be correct, so it goes back to Triage & Seriousness
      // for reassessment rather than sitting wherever it happened to be
      // (up to and including already-Submitted — a follow-up cycle can
      // only still be open on a case that hasn't reached Closed &
      // Archived yet, since that transition's own guard blocks closing
      // while a follow-up cycle is open). A case already at Intake or
      // Triage is left alone — there's nothing further back to reopen.
      await this.reopenCaseToTriage(tx, companyId, followUp.caseId, meta)

      await this.auditService.log(tx, {
        companyId,
        actorType: 'system',
        action: 'pv_case_follow_up_cycle_reset',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: followUp.caseId,
        newValue: {
          followUpId: followUp.id,
          attemptNumber,
          nextCheckDueAt: nextCheckDueAt.toISOString(),
        },
        ip: meta.ip,
      })

      // Stage 11.1 — the due-list task's title carries the due date, so a
      // reset needs a fresh task (with the new date) rather than leaving
      // the old, now-stale one open.
      const nextDueDateStr = nextCheckDueAt.toISOString().slice(0, 10)
      const title = `${FOLLOW_UP_TASK_TITLE_PREFIX} ${attemptNumber} — case ${pvCase.referenceNumber} — due ${nextDueDateStr} (new information received)`
      const handler = await this.resolveHandler(tx, companyId, pvCase.createdBy)
      await this.closeOpenFollowUpTasks(tx, companyId, pvCase.id, meta)
      await this.tasksService.createForWorkflowState(
        {
          companyId,
          recordType: PV_CASE_RECORD_TYPE,
          recordId: pvCase.id,
          title,
          ...handler.taskAssignment,
        },
        meta,
      )
      return
    }

    // outcome === 'no_response'
    if (attemptNumber === 1) {
      await tx.caseFollowUp.update({
        where: { id: followUp.id },
        data: { status: 'pending_attempt_2' },
      })
      await this.triggerAttempt(
        tx,
        companyId,
        { ...followUp, status: 'pending_attempt_2' },
        pvCase,
        pvCase.reporter,
        2,
        meta,
      )
    } else {
      await this.closeFollowUp(
        tx,
        companyId,
        followUp,
        'closed_failed',
        'No response after 2 attempts',
        meta,
      )
    }
  }

  private async closeFollowUp(
    tx: Prisma.TransactionClient,
    companyId: string,
    followUp: CaseFollowUp,
    status: 'closed_resolved' | 'closed_failed',
    reason: string,
    meta: RequestMeta,
  ): Promise<void> {
    if (followUp.status === 'closed_resolved' || followUp.status === 'closed_failed') return

    await tx.caseFollowUp.update({
      where: { id: followUp.id },
      data: { status, closedAt: new Date(), closedReason: reason },
    })

    await this.auditService.log(tx, {
      companyId,
      actorType: 'system',
      action: 'pv_case_follow_up_closed',
      recordType: PV_CASE_RECORD_TYPE,
      recordId: followUp.caseId,
      newValue: { followUpId: followUp.id, status, reason },
      ip: meta.ip,
    })

    // Stage 11.1 — nothing left to do once the cycle closes; clear the due-list task.
    await this.closeOpenFollowUpTasks(tx, companyId, followUp.caseId, meta)

    const pvCase = await tx.case.findFirst({
      where: { id: followUp.caseId, companyId },
      select: { createdBy: true },
    })
    const handler = await this.resolveHandler(tx, companyId, pvCase?.createdBy ?? null)
    for (const recipient of handler.recipients) {
      await this.notificationsService.create({
        companyId,
        userId: recipient.id,
        category: 'case_follow_up',
        title: `Follow-up closed: ${status === 'closed_resolved' ? 'resolved' : 'failed to reach reporter'}`,
        body: reason,
        recordType: PV_CASE_RECORD_TYPE,
        recordId: followUp.caseId,
      })
    }
  }

  /**
   * Real-usage request, 22 Sep 2026 (item 18) — a direct, system-owned
   * workflow-state override, deliberately **not** routed through
   * `WorkflowService.transition()`: that method requires a real actor
   * holding the target transition's required role, which doesn't fit a
   * system-triggered reset with no human actor behind it (the periodic
   * timeout path, `processDue()`, can hit this too). Mirrors
   * `PvWorkflowGuards`'s own registered status-sync function exactly
   * (`Case.status = toStateKey`) so the denormalized column stays
   * consistent with the real `WorkflowInstance`, the same guarantee a
   * normal transition already provides. A no-op if the case is already
   * at Intake or Triage (nothing further back to reopen), and — per
   * `PvWorkflowGuards`'s own submitted→closed_archived guard, which
   * blocks closing while a follow-up cycle is still open — this can
   * never actually run against an already-Closed & Archived case.
   */
  private async reopenCaseToTriage(
    tx: Prisma.TransactionClient,
    companyId: string,
    caseId: string,
    meta: RequestMeta,
  ): Promise<void> {
    const instance = await tx.workflowInstance.findFirst({
      where: { recordType: PV_CASE_RECORD_TYPE, recordId: caseId },
      include: { currentState: true },
    })
    if (!instance || instance.currentState.stateKey === 'intake' || instance.currentState.stateKey === 'triage') {
      return
    }

    const triageState = await tx.workflowState.findFirst({
      where: { definitionId: instance.definitionId, stateKey: 'triage' },
    })
    if (!triageState) return

    const fromStateKey = instance.currentState.stateKey
    await tx.workflowInstance.update({
      where: { id: instance.id },
      data: { currentStateId: triageState.id, enteredAt: new Date(), version: { increment: 1 } },
    })
    await tx.case.update({ where: { id: caseId }, data: { status: 'triage' } })

    await this.auditService.log(tx, {
      companyId,
      actorType: 'system',
      action: 'pv_case_reopened_for_follow_up',
      recordType: PV_CASE_RECORD_TYPE,
      recordId: caseId,
      oldValue: { stateKey: fromStateKey },
      newValue: { stateKey: 'triage', reason: 'Reporter provided new information during follow-up' },
      ip: meta.ip,
    })
  }

  /**
   * Stage 11.1 — the real handler for a case's follow-up cycle: whoever
   * captured it (`Case.createdBy`), if that account still exists and is
   * active. Falls back to the pre-existing role-based fan-out
   * (`resolveStaffRecipients()`) for a system-channel case (no
   * individual captor — `createdBy` is null by design for public URL/
   * WhatsApp/email intake) or if the original captor's account has since
   * been deactivated. Returns both the notification recipient list and
   * the matching `Task` assignment shape, since the two always agree —
   * a single named handler, or a role-queue.
   */
  private async resolveHandler(
    tx: Prisma.TransactionClient,
    companyId: string,
    createdBy: string | null,
  ): Promise<{
    recipients: { id: string; email: string }[]
    taskAssignment: { assignedUserId?: string; assignedRoleKey?: string }
  }> {
    if (createdBy) {
      const captor = await tx.user.findFirst({
        where: { id: createdBy, companyId, status: 'active' },
        select: { id: true, email: true },
      })
      if (captor) {
        return { recipients: [captor], taskAssignment: { assignedUserId: captor.id } }
      }
    }
    return {
      recipients: await this.resolveStaffRecipients(tx, companyId),
      taskAssignment: { assignedRoleKey: FOLLOW_UP_FALLBACK_ROLE_KEY },
    }
  }

  /** Every user in the company holding a role that grants `pv.triage_case` — a generic, permission-driven fan-out (not a hardcoded role-key list), matching `WorkflowTaskEscalationNotifier`'s own role-queue fan-out precedent. Used by `resolveHandler()`'s own fallback path. */
  private async resolveStaffRecipients(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<{ id: string; email: string }[]> {
    const roles = await tx.role.findMany({
      where: { permissions: { some: { permission: { key: 'pv.triage_case' } } } },
      select: { key: true },
    })
    if (roles.length === 0) return []
    return tx.user.findMany({
      where: { companyId, roleKeys: { hasSome: roles.map((r) => r.key) } },
      select: { id: true, email: true },
    })
  }

  /** Plain-language "name · phone · email" summary for the notification body — Stage 11.1's own fix for the original report ("doesn't include who to contact"). */
  private formatReporterContact(reporter: Reporter | null): string {
    const parts = [reporter?.fullName, reporter?.phone, reporter?.email].filter(
      (p): p is string => !!p,
    )
    return parts.length > 0 ? parts.join(' · ') : 'no reporter contact details on file'
  }

  /**
   * Closes whatever follow-up task is currently open on this case, if
   * any — every follow-up task's title starts with
   * `FOLLOW_UP_TASK_TITLE_PREFIX`, so this can find and close it without
   * a schema change, and without touching an unrelated workflow-state
   * task that might also be open on the same case at the same time
   * (`TasksService.closeOpenForRecord()` would incorrectly close both —
   * not used here on purpose).
   */
  private async closeOpenFollowUpTasks(
    tx: Prisma.TransactionClient,
    companyId: string,
    caseId: string,
    meta: RequestMeta,
  ): Promise<void> {
    const open = await tx.task.findMany({
      where: {
        companyId,
        recordType: PV_CASE_RECORD_TYPE,
        recordId: caseId,
        status: { in: ['open', 'claimed'] },
        title: { startsWith: FOLLOW_UP_TASK_TITLE_PREFIX },
      },
    })
    for (const task of open) {
      await tx.task.update({
        where: { id: task.id },
        data: { status: 'closed', closedAt: new Date() },
      })
      await this.auditService.log(tx, {
        companyId,
        actorType: 'system',
        action: 'task_closed',
        recordType: 'task',
        recordId: task.id,
        ip: meta.ip,
      })
    }
  }

  /** Every case-level encrypted field gets decrypted on read, never left as raw ciphertext in an API response — see CLAUDE.md's own gotchas entry on why this matters (a field that's only ever encrypted, never decrypted anywhere, effectively vanishes for good). */
  private decryptAttempts(
    followUp: CaseFollowUp & { attempts: CaseFollowUpAttempt[] },
  ): CaseFollowUpWithAttempts {
    return {
      ...followUp,
      attempts: followUp.attempts.map((a) => {
        const { noteEncrypted, ...rest } = a
        return { ...rest, note: noteEncrypted ? this.textEncryption.decrypt(noteEncrypted) : null }
      }),
    }
  }
}
