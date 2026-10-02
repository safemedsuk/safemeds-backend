import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, Signal } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { RolesService } from '../roles/roles.service'
import { WorkflowService } from '../workflow/workflow.service'
import { CreateSignalDto } from './dto/create-signal.dto'
import { RecordSignalAssessmentDto } from './dto/record-signal-assessment.dto'
import { RecordSignalPrioritisationDto } from './dto/record-signal-prioritisation.dto'
import { RecordSignalRecommendationDto } from './dto/record-signal-recommendation.dto'
import { RecordSignalValidationDto } from './dto/record-signal-validation.dto'

export interface RequestMeta {
  ip?: string
}

export const SIGNAL_RECORD_TYPE = 'signal'

export interface LinkedCaseSummary {
  id: string
  referenceNumber: string
  status: string
  duplicateOfCaseId: string | null
}

export interface SignalTransitionLogEntry {
  fromStateKey: string | null
  toStateKey: string
  note: string | null
  actorName: string | null
  occurredAt: Date
}

export interface SignalWithDetail extends Signal {
  linkedCases: LinkedCaseSummary[]
  transitionHistory: SignalTransitionLogEntry[]
  workflowInstanceId: string | null
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Signals are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * VigiCloud Stage 17 — GVP Module IX §IX.A.1.1's six activities, minus the
 * lifecycle transitions themselves (those go through the generic
 * `POST /workflow/instances/:id/transition`, exactly like `pv_case` —
 * see `SignalWorkflowGuards` for the domain-specific gating on top of
 * that generic mechanism). This service owns everything the generic
 * workflow engine doesn't know about: creating a signal (manually or from
 * detection), and recording the actual validation/prioritisation/
 * assessment/recommendation data at each stage — deliberately **not**
 * gated by which lifecycle state the signal is currently in (a QPPV can
 * fill in prioritisation notes before formally transitioning into that
 * state, the same way `CapaService.update()` lets fields be edited
 * independently of status) — only the *transition itself* is gated, by
 * `SignalWorkflowGuards`'s rationale-required check.
 */
@Injectable()
export class SignalService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly rolesService: RolesService,
    private readonly workflowService: WorkflowService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateSignalDto, meta: RequestMeta): Promise<Signal> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await this.createInTx(tx, companyId, {
        title: dto.title,
        description: dto.description,
        productIdentifier: dto.productIdentifier,
        batchNumber: dto.batchNumber ?? null,
        detectionMethod: 'manual',
        createdBy: actor.sub,
        productId: dto.productId ?? null,
      })

      if (dto.caseIds && dto.caseIds.length > 0) {
        await this.linkCasesInTx(tx, companyId, created.id, dto.caseIds)
      }

      await this.workflowService.instantiate(actor, SIGNAL_RECORD_TYPE, created.id, null, meta)

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'signal_raised',
        recordType: SIGNAL_RECORD_TYPE,
        recordId: created.id,
        newValue: {
          title: created.title,
          productIdentifier: created.productIdentifier,
          productId: created.productId,
          detectionMethod: 'manual',
        },
        ip: meta.ip,
      })

      return created
    })
  }

  /**
   * The shared row-creation logic `SignalDetectionService` also uses —
   * takes an already-open transaction (nested `RlsService` calls reuse
   * the ambient one via `AsyncLocalStorage`, so this never opens a second
   * one) rather than an `actor`, since detection has no human actor.
   */
  async createInTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    data: {
      title: string
      description: string
      productIdentifier: string
      batchNumber: string | null
      detectionMethod: string
      createdBy?: string
      productId?: string | null
    },
  ): Promise<Signal> {
    return tx.signal.create({
      data: {
        id: newId(),
        companyId,
        title: data.title,
        description: data.description,
        productIdentifier: data.productIdentifier,
        batchNumber: data.batchNumber,
        detectionMethod: data.detectionMethod,
        createdBy: data.createdBy ?? null,
        productId: data.productId ?? null,
      },
    })
  }

  async linkCasesInTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    signalId: string,
    caseIds: string[],
  ): Promise<number> {
    let newlyLinked = 0
    for (const caseId of caseIds) {
      const existing = await tx.signalCase.findUnique({
        where: { signalId_caseId: { signalId, caseId } },
      })
      if (existing) continue
      await tx.signalCase.create({ data: { id: newId(), companyId, signalId, caseId } })
      newlyLinked += 1
    }
    return newlyLinked
  }

  async recordValidation(
    actor: AuthenticatedUser,
    id: string,
    dto: RecordSignalValidationDto,
    meta: RequestMeta,
  ): Promise<Signal> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.signal.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Signal not found' })
      }

      // "Strength of evidence (case count after de-duplication)" — Stage
      // 10's Master Case concept, computed automatically, never hand-typed.
      const links = await tx.signalCase.findMany({
        where: { signalId: id },
        select: { case: { select: { duplicateOfCaseId: true } } },
      })
      const strengthOfEvidenceCaseCount = links.filter(
        (l) => l.case.duplicateOfCaseId === null,
      ).length

      const updated = await tx.signal.update({
        where: { id },
        data: {
          previousAwareness: dto.previousAwareness,
          previousAwarenessNote: dto.previousAwarenessNote,
          clinicalRelevanceNote: dto.clinicalRelevanceNote,
          strengthOfEvidenceCaseCount,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'signal_validation_recorded',
        recordType: SIGNAL_RECORD_TYPE,
        recordId: id,
        newValue: { previousAwareness: dto.previousAwareness, strengthOfEvidenceCaseCount },
        ip: meta.ip,
      })

      return updated
    })
  }

  async recordPrioritisation(
    actor: AuthenticatedUser,
    id: string,
    dto: RecordSignalPrioritisationDto,
    meta: RequestMeta,
  ): Promise<Signal> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.signal.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Signal not found' })
      }

      const updated = await tx.signal.update({
        where: { id },
        data: {
          severityNote: dto.severityNote,
          patientExposureNote: dto.patientExposureNote,
          expectedRegulatoryResponseNote: dto.expectedRegulatoryResponseNote,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'signal_prioritisation_recorded',
        recordType: SIGNAL_RECORD_TYPE,
        recordId: id,
        newValue: dto as Record<string, unknown>,
        ip: meta.ip,
      })

      return updated
    })
  }

  async recordAssessment(
    actor: AuthenticatedUser,
    id: string,
    dto: RecordSignalAssessmentDto,
    meta: RequestMeta,
  ): Promise<Signal> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.signal.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Signal not found' })
      }

      const updated = await tx.signal.update({
        where: { id },
        data: { assessmentNote: dto.assessmentNote, assessedBy: actor.sub },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'signal_assessment_recorded',
        recordType: SIGNAL_RECORD_TYPE,
        recordId: id,
        newValue: { assessmentNote: dto.assessmentNote },
        ip: meta.ip,
      })

      return updated
    })
  }

  async recordRecommendation(
    actor: AuthenticatedUser,
    id: string,
    dto: RecordSignalRecommendationDto,
    meta: RequestMeta,
  ): Promise<Signal> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.signal.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Signal not found' })
      }

      const updated = await tx.signal.update({
        where: { id },
        data: {
          recommendationAction: dto.recommendationAction,
          recommendationNote: dto.recommendationNote,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'signal_recommendation_recorded',
        recordType: SIGNAL_RECORD_TYPE,
        recordId: id,
        newValue: { recommendationAction: dto.recommendationAction },
        ip: meta.ip,
      })

      return updated
    })
  }

  async linkCases(
    actor: AuthenticatedUser,
    id: string,
    caseIds: string[],
    meta: RequestMeta,
  ): Promise<void> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.signal.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Signal not found' })
      }

      const newlyLinked = await this.linkCasesInTx(tx, companyId, id, caseIds)
      if (newlyLinked > 0) {
        await this.auditService.log(tx, {
          companyId,
          actorUserId: actor.sub,
          action: 'signal_cases_linked',
          recordType: SIGNAL_RECORD_TYPE,
          recordId: id,
          newValue: { caseIds, newlyLinked },
          ip: meta.ip,
        })
      }
    })
  }

  async list(actor: AuthenticatedUser): Promise<Signal[]> {
    const companyId = requireCompany(actor)
    await this.requireReadAccess(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.signal.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } }),
    )
  }

  async get(actor: AuthenticatedUser, id: string): Promise<SignalWithDetail> {
    const companyId = requireCompany(actor)
    await this.requireReadAccess(actor)

    const signal = await this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.signal.findFirst({ where: { id, companyId } })
      if (!found) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Signal not found' })
      }

      const links = await tx.signalCase.findMany({
        where: { signalId: id },
        include: {
          case: {
            select: { id: true, referenceNumber: true, status: true, duplicateOfCaseId: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      })

      const workflowInstance = await tx.workflowInstance.findFirst({
        where: { recordType: SIGNAL_RECORD_TYPE, recordId: id },
        include: { currentState: true },
      })

      return {
        ...found,
        // Same live-vs-denormalized-cache reconciliation `PvCaseService.get()`
        // already established for `Case.status` — see that method's own
        // doc comment for why `list()` may still trust the stored column.
        status: workflowInstance?.currentState.stateKey ?? found.status,
        linkedCases: links.map((l) => l.case),
        workflowInstanceId: workflowInstance?.id ?? null,
      }
    })

    const historyPage = await this.auditService.query(actor, {
      recordType: SIGNAL_RECORD_TYPE,
      recordId: id,
      action: 'state_change',
      page: 1,
      limit: 50,
    })
    const transitionHistory: SignalTransitionLogEntry[] = historyPage.data.map((entry) => {
      const oldValue = entry.oldValue as { stateKey?: string } | null
      const newValue = entry.newValue as { stateKey?: string; note?: string } | null
      return {
        fromStateKey: oldValue?.stateKey ?? null,
        toStateKey: newValue?.stateKey ?? '',
        note: newValue?.note ?? null,
        actorName: entry.actorName,
        occurredAt: entry.occurredAt,
      }
    })

    return { ...signal, transitionHistory }
  }

  /** Mirrors `ClinicalTrialService.requireReadAccess()`'s own reasoning — a single ANDed `@RequirePermissions()` can't express "view or manage" as alternatives. */
  private async requireReadAccess(actor: AuthenticatedUser): Promise<void> {
    const permissions = await this.rolesService.getPermissionsForUser(actor)
    if (permissions.has('pv.manage_signals') || permissions.has('pv.view_all')) {
      return
    }
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to view signals',
    })
  }
}
