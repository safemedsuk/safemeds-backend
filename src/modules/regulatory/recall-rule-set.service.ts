import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { RecallRule, RecallRuleSet, RecallSubmissionTemplate } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { CreateRecallRuleDto } from './dto/create-recall-rule.dto'
import { CreateRecallRuleSetDto } from './dto/create-recall-rule-set.dto'
import { CreateRecallSubmissionTemplateDto } from './dto/create-recall-submission-template.dto'
import { UpdateRecallRuleDto } from './dto/update-recall-rule.dto'

export interface RequestMeta {
  ip?: string
}

export type RecallRuleSetWithRules = RecallRuleSet & {
  rules: RecallRule[]
  submissionTemplates: RecallSubmissionTemplate[]
}

/**
 * QualCloud (Phase 13) Stage 10.1 — the recall country rules engine's
 * own admin/platform half. Platform-wide reference data, no RLS —
 * exactly `InspectionChecklistService`'s own precedent (plain
 * `PrismaService`, `platform.recall_rules.manage`-gated writes, held
 * only by the platform `regulatory_lead` role) applied to a new rule
 * domain. Version-on-write per `(countryId, regulatoryAuthorityId)` —
 * `create()` always starts a new `draft` version; there is no in-place
 * update to a rule-set's own header once created, only to its still-draft
 * child rules (`updateRule`) — matching `ReportingRule`'s own discipline
 * that a rule only ever drives a real deadline once its rule-set is
 * `live` (the Engineering Build Package's own closing line: show "per
 * rule-set" until then, never a fabricated date).
 */
@Injectable()
export class RecallRuleSetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(countryId?: string): Promise<RecallRuleSetWithRules[]> {
    return this.prisma.recallRuleSet.findMany({
      where: countryId ? { countryId } : undefined,
      include: { rules: true, submissionTemplates: true },
      orderBy: [{ countryId: 'asc' }, { version: 'desc' }],
    })
  }

  async get(id: string): Promise<RecallRuleSetWithRules> {
    const found = await this.prisma.recallRuleSet.findUnique({
      where: { id },
      include: { rules: true, submissionTemplates: true },
    })
    if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rule-set not found' })
    return found
  }

  /** The live rule-set for a given country/authority — the only one that ever resolves a real deadline. */
  async getLive(countryId: string, regulatoryAuthorityId: string): Promise<RecallRuleSetWithRules | null> {
    return this.prisma.recallRuleSet.findFirst({
      where: { countryId, regulatoryAuthorityId, status: 'live' },
      include: { rules: true, submissionTemplates: true },
    })
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateRecallRuleSetDto,
    meta: RequestMeta,
  ): Promise<RecallRuleSetWithRules> {
    const maxVersion = await this.prisma.recallRuleSet.aggregate({
      where: { countryId: dto.countryId, regulatoryAuthorityId: dto.regulatoryAuthorityId },
      _max: { version: true },
    })
    const version = (maxVersion._max.version ?? 0) + 1

    const created = await this.prisma.recallRuleSet.create({
      data: {
        id: newId(),
        countryId: dto.countryId,
        regulatoryAuthorityId: dto.regulatoryAuthorityId,
        version,
        status: 'draft',
        createdBy: actor.sub,
      },
      include: { rules: true, submissionTemplates: true },
    })

    await this.auditService.log(this.prisma, {
      actorUserId: actor.sub,
      action: 'recall_rule_set_created',
      recordType: 'recall_rule_set',
      recordId: created.id,
      newValue: { countryId: dto.countryId, regulatoryAuthorityId: dto.regulatoryAuthorityId, version },
      ip: meta.ip,
    })
    return created
  }

  async addRule(
    actor: AuthenticatedUser,
    ruleSetId: string,
    dto: CreateRecallRuleDto,
    meta: RequestMeta,
  ): Promise<RecallRule> {
    const ruleSet = await this.prisma.recallRuleSet.findUnique({ where: { id: ruleSetId } })
    if (!ruleSet) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rule-set not found' })
    if (ruleSet.status === 'live' || ruleSet.status === 'retired') {
      throw new ConflictException({
        code: 'RULE_SET_NOT_EDITABLE',
        message: 'A live or retired rule-set cannot have rules added — start a new version instead',
      })
    }

    const created = await this.prisma.recallRule.create({
      data: {
        id: newId(),
        ruleSetId,
        code: dto.code,
        requirementText: dto.requirementText,
        appliesWhenClass: dto.appliesWhenClass ?? null,
        appliesWhenLevel: dto.appliesWhenLevel ?? null,
        appliesWhenType: dto.appliesWhenType ?? null,
        anchorEvent: dto.anchorEvent,
        offset: dto.offset,
        unit: dto.unit ?? 'days',
        dayBasis: dto.dayBasis ?? 'calendar',
        ownerRoleKey: dto.ownerRoleKey,
        evidenceTypes: dto.evidenceTypes ?? [],
        approvalRequired: dto.approvalRequired ?? false,
        blocksClosure: dto.blocksClosure ?? false,
        submissionTemplateId: dto.submissionTemplateId ?? null,
        sourceDoc: dto.sourceDoc,
        sourceInstrument: dto.sourceInstrument ?? null,
        sourceSection: dto.sourceSection ?? null,
        sourceUrl: dto.sourceUrl ?? null,
        unverified: dto.unverified ?? true,
      },
    })
    await this.auditService.log(this.prisma, {
      actorUserId: actor.sub,
      action: 'recall_rule_added',
      recordType: 'recall_rule_set',
      recordId: ruleSetId,
      newValue: { code: created.code, anchorEvent: created.anchorEvent, offset: created.offset },
      ip: meta.ip,
    })
    return created
  }

  async updateRule(
    actor: AuthenticatedUser,
    ruleId: string,
    dto: UpdateRecallRuleDto,
    meta: RequestMeta,
  ): Promise<RecallRule> {
    const existing = await this.prisma.recallRule.findUnique({
      where: { id: ruleId },
      include: { ruleSet: true },
    })
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rule not found' })
    if (existing.ruleSet.status === 'live' || existing.ruleSet.status === 'retired') {
      throw new ConflictException({
        code: 'RULE_SET_NOT_EDITABLE',
        message: 'A live or retired rule-set cannot have its rules edited — start a new version instead',
      })
    }

    const updated = await this.prisma.recallRule.update({
      where: { id: ruleId },
      data: {
        ...(dto.requirementText !== undefined ? { requirementText: dto.requirementText } : {}),
        ...(dto.appliesWhenClass !== undefined ? { appliesWhenClass: dto.appliesWhenClass } : {}),
        ...(dto.appliesWhenLevel !== undefined ? { appliesWhenLevel: dto.appliesWhenLevel } : {}),
        ...(dto.appliesWhenType !== undefined ? { appliesWhenType: dto.appliesWhenType } : {}),
        ...(dto.anchorEvent !== undefined ? { anchorEvent: dto.anchorEvent } : {}),
        ...(dto.offset !== undefined ? { offset: dto.offset } : {}),
        ...(dto.dayBasis !== undefined ? { dayBasis: dto.dayBasis } : {}),
        ...(dto.ownerRoleKey !== undefined ? { ownerRoleKey: dto.ownerRoleKey } : {}),
        ...(dto.evidenceTypes !== undefined ? { evidenceTypes: dto.evidenceTypes } : {}),
        ...(dto.approvalRequired !== undefined ? { approvalRequired: dto.approvalRequired } : {}),
        ...(dto.blocksClosure !== undefined ? { blocksClosure: dto.blocksClosure } : {}),
        ...(dto.submissionTemplateId !== undefined
          ? { submissionTemplateId: dto.submissionTemplateId }
          : {}),
        ...(dto.sourceDoc !== undefined ? { sourceDoc: dto.sourceDoc } : {}),
        ...(dto.sourceInstrument !== undefined ? { sourceInstrument: dto.sourceInstrument } : {}),
        ...(dto.sourceSection !== undefined ? { sourceSection: dto.sourceSection } : {}),
        ...(dto.sourceUrl !== undefined ? { sourceUrl: dto.sourceUrl } : {}),
        ...(dto.unverified !== undefined ? { unverified: dto.unverified } : {}),
      },
    })
    await this.auditService.log(this.prisma, {
      actorUserId: actor.sub,
      action: 'recall_rule_updated',
      recordType: 'recall_rule_set',
      recordId: existing.ruleSetId,
      oldValue: { requirementText: existing.requirementText, offset: existing.offset },
      newValue: { requirementText: updated.requirementText, offset: updated.offset },
      ip: meta.ip,
    })
    return updated
  }

  async addSubmissionTemplate(
    actor: AuthenticatedUser,
    ruleSetId: string,
    dto: CreateRecallSubmissionTemplateDto,
    meta: RequestMeta,
  ): Promise<RecallSubmissionTemplate> {
    const ruleSet = await this.prisma.recallRuleSet.findUnique({ where: { id: ruleSetId } })
    if (!ruleSet) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rule-set not found' })

    const created = await this.prisma.recallSubmissionTemplate.create({
      data: {
        id: newId(),
        ruleSetId,
        code: dto.code,
        name: dto.name,
        format: dto.format ?? 'pdf',
      },
    })
    await this.auditService.log(this.prisma, {
      actorUserId: actor.sub,
      action: 'recall_submission_template_created',
      recordType: 'recall_rule_set',
      recordId: ruleSetId,
      newValue: { code: created.code, name: created.name },
      ip: meta.ip,
    })
    return created
  }

  /**
   * `draft`/`pending_source` → `live`. Retires whatever was previously
   * live for the same `(countryId, regulatoryAuthorityId)` — the same
   * DB-partial-unique-index-enforced "one active/live at a time" shape
   * `ReportingRule`'s own `.../activate` endpoint already established,
   * applied here at the app-code level via a transaction (no partial
   * unique index on `RecallRuleSet.status='live'` was added to the
   * schema — a rule-set is looked up by `(countryId,
   * regulatoryAuthorityId, status: 'live')`, a query, not a constraint;
   * kept honest here rather than silently claimed as DB-enforced).
   */
  async signOff(
    actor: AuthenticatedUser,
    ruleSetId: string,
    meta: RequestMeta,
  ): Promise<RecallRuleSetWithRules> {
    const ruleSet = await this.prisma.recallRuleSet.findUnique({ where: { id: ruleSetId } })
    if (!ruleSet) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rule-set not found' })
    if (ruleSet.status === 'live') {
      throw new ConflictException({ code: 'ALREADY_LIVE', message: 'This rule-set is already live' })
    }
    if (ruleSet.status === 'retired') {
      throw new ConflictException({ code: 'RETIRED', message: 'A retired rule-set cannot be signed off' })
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.recallRuleSet.updateMany({
        where: {
          countryId: ruleSet.countryId,
          regulatoryAuthorityId: ruleSet.regulatoryAuthorityId,
          status: 'live',
        },
        data: { status: 'retired' },
      })
      const result = await tx.recallRuleSet.update({
        where: { id: ruleSetId },
        data: {
          status: 'live',
          signedOffBy: actor.sub,
          signedOffAt: new Date(),
          effectiveDate: ruleSet.effectiveDate ?? new Date(),
        },
        include: { rules: true, submissionTemplates: true },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        action: 'recall_rule_set_signed_off',
        recordType: 'recall_rule_set',
        recordId: ruleSetId,
        newValue: { version: ruleSet.version },
        ip: meta.ip,
      })
      return result
    })
    return updated
  }
}
