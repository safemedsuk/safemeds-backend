import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, RecallCountry, RecallRequirement } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { TasksService } from '../tasks/tasks.service'
import { CreateRecallCountryDto } from './dto/create-recall-country.dto'
import { UpdateRecallCountryDto } from './dto/update-recall-country.dto'
import { UpdateRecallRequirementDto } from './dto/update-recall-requirement.dto'
import { computeDueAt, resolveRecallAnchorTimestamp } from './recall-anchor-event.util'
import { RecallRuleSetService } from './recall-rule-set.service'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A recall country is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 10.2 — `RecallCountry`'s tenant-side
 * lifecycle plus 10.1's own rule-evaluation engine (`evaluateForCountry`),
 * kept in the same service since neither has a reason to exist without
 * the other. Loads the country's live `RecallRuleSet` (per
 * `RecallRuleSetService.getLive()`) and evaluates each rule's
 * `appliesWhen*` against the recall's own class/level/type, producing
 * one `RecallRequirement` per matching rule. A case keeps the rule
 * version it started with — re-running evaluation (on approval, or on
 * any scope/country change) only adds newly-matching requirements, it
 * never rewrites an existing row's `ruleVersion` in place, matching
 * `ReportingRule` resolution's own already-established precedent for
 * "don't silently migrate a case onto a newer rule mid-flight."
 */
@Injectable()
export class RecallCountryService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly tasksService: TasksService,
    private readonly ruleSetService: RecallRuleSetService,
  ) {}

  async list(actor: AuthenticatedUser, recallId: string): Promise<RecallCountry[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.recallCountry.findMany({ where: { companyId, recallId }, orderBy: { createdAt: 'asc' } }),
    )
  }

  async listRequirements(actor: AuthenticatedUser, recallCountryId: string): Promise<RecallRequirement[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const country = await tx.recallCountry.findFirst({ where: { id: recallCountryId, companyId } })
      if (!country) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall country not found' })
      }
      return tx.recallRequirement.findMany({
        where: { companyId, recallCountryId },
        orderBy: { dueAt: 'asc' },
      })
    })
  }

  async addCountry(
    actor: AuthenticatedUser,
    recallId: string,
    dto: CreateRecallCountryDto,
    meta: RequestMeta,
  ): Promise<RecallCountry> {
    const companyId = requireCompany(actor)

    const created = await this.rls.runAsCompany(companyId, async (tx) => {
      const recall = await tx.recall.findFirst({ where: { id: recallId, companyId } })
      if (!recall) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall not found' })

      const existing = await tx.recallCountry.findUnique({
        where: { recallId_countryId: { recallId, countryId: dto.countryId } },
      })
      if (existing) return existing

      let ruleSetId: string | null = null
      let ruleSetVersion: number | null = null
      if (dto.regulatoryAuthorityId) {
        const live = await this.ruleSetService.getLive(dto.countryId, dto.regulatoryAuthorityId)
        if (live) {
          ruleSetId = live.id
          ruleSetVersion = live.version
        }
      }

      return tx.recallCountry.create({
        data: {
          id: newId(),
          companyId,
          recallId,
          countryId: dto.countryId,
          regulatoryAuthorityId: dto.regulatoryAuthorityId ?? null,
          ruleSetId,
          ruleSetVersion,
          class: recall.recallClass,
          level: recall.level,
        },
      })
    })

    await this.evaluateForCountry(actor, created.id, meta)
    return created
  }

  async updateCountry(
    actor: AuthenticatedUser,
    recallCountryId: string,
    dto: UpdateRecallCountryDto,
    meta: RequestMeta,
  ): Promise<RecallCountry> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.recallCountry.findFirst({
        where: { id: recallCountryId, companyId },
      })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall country not found' })
      }
      const updated = await tx.recallCountry.update({
        where: { id: recallCountryId },
        data: {
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.regulatorDecision !== undefined
            ? { regulatorDecision: dto.regulatorDecision, regulatorApprovalAt: new Date() }
            : {}),
        },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_country_updated',
        recordType: 'recall_country',
        recordId: recallCountryId,
        oldValue: { status: existing.status },
        newValue: { status: updated.status, regulatorDecision: updated.regulatorDecision },
        ip: meta.ip,
      })
      return updated
    })
  }

  /**
   * Re-runs 10.1's own rules engine for one `RecallCountry` — called on
   * `addCountry()` and should be re-called by whatever action later
   * freezes a scope version or changes the recall's class/level/type.
   * Missing anchor timestamps yield `deadline_pending` + a real `Task`
   * for `platform.config`-independent, tenant-owned follow-up — never a
   * silent null.
   */
  async evaluateForCountry(
    actor: AuthenticatedUser,
    recallCountryId: string,
    meta: RequestMeta,
  ): Promise<RecallRequirement[]> {
    const companyId = requireCompany(actor)

    const { pending, created } = await this.rls.runAsCompany(companyId, async (tx) => {
      const country = await tx.recallCountry.findFirst({ where: { id: recallCountryId, companyId } })
      if (!country) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall country not found' })
      }
      if (!country.ruleSetId || !country.ruleSetVersion) {
        // No live rule-set for this country/authority yet — nothing to
        // evaluate. The Engineering Build Package's own instruction:
        // show "per rule-set," never fabricate a deadline.
        return { pending: [] as { requirementId: string; title: string }[], created: [] }
      }
      const recall = await tx.recall.findUniqueOrThrow({ where: { id: country.recallId } })
      const ruleSet = await this.ruleSetService.get(country.ruleSetId)

      const pendingTasks: { requirementId: string; title: string }[] = []
      const createdRows: RecallRequirement[] = []

      for (const rule of ruleSet.rules) {
        if (rule.appliesWhenClass && rule.appliesWhenClass !== country.class) continue
        if (rule.appliesWhenLevel && rule.appliesWhenLevel !== country.level) continue
        if (rule.appliesWhenType && rule.appliesWhenType !== recall.type) continue

        const existing = await tx.recallRequirement.findUnique({
          where: { recallCountryId_recallRuleId: { recallCountryId, recallRuleId: rule.id } },
        })
        if (existing) continue

        const anchorTimestamp = resolveRecallAnchorTimestamp(rule.anchorEvent, recall, country)
        const dueAt =
          anchorTimestamp && !rule.unverified ? computeDueAt(anchorTimestamp, rule.offset) : null

        const row = await tx.recallRequirement.create({
          data: {
            id: newId(),
            companyId,
            recallCountryId,
            recallRuleId: rule.id,
            ruleVersion: country.ruleSetVersion,
            dueAt,
            ownerRoleKey: rule.ownerRoleKey,
            status: dueAt ? 'open' : 'deadline_pending',
          },
        })
        createdRows.push(row)
        if (!dueAt) {
          pendingTasks.push({ requirementId: row.id, title: `Resolve deadline: ${rule.requirementText}` })
        }
      }

      if (createdRows.length > 0) {
        await this.auditService.log(tx, {
          companyId,
          actorUserId: actor.sub,
          action: 'recall_requirements_evaluated',
          recordType: 'recall_country',
          recordId: recallCountryId,
          newValue: { added: createdRows.length },
          ip: meta.ip,
        })
      }
      return { pending: pendingTasks, created: createdRows }
    })

    for (const p of pending) {
      await this.tasksService.createForWorkflowState(
        {
          companyId,
          recordType: 'recall_requirement',
          recordId: p.requirementId,
          title: p.title,
          assignedRoleKey: 'QUALITY_MANAGER',
          actorUserId: actor.sub,
        },
        meta,
      )
    }

    return created
  }

  async updateRequirement(
    actor: AuthenticatedUser,
    requirementId: string,
    dto: UpdateRecallRequirementDto,
    meta: RequestMeta,
  ): Promise<RecallRequirement> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.recallRequirement.findFirst({
        where: { id: requirementId, companyId },
      })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall requirement not found' })
      }
      const data: Prisma.RecallRequirementUpdateInput = {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.evidenceIds !== undefined ? { evidenceIds: dto.evidenceIds } : {}),
      }
      if (dto.status === 'complete') data.completedAt = new Date()
      const updated = await tx.recallRequirement.update({ where: { id: requirementId }, data })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_requirement_updated',
        recordType: 'recall_requirement',
        recordId: requirementId,
        oldValue: { status: existing.status },
        newValue: { status: updated.status },
        ip: meta.ip,
      })
      return updated
    })
  }
}
