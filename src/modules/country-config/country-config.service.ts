import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  ConfigStatus,
  FormSchema,
  Prisma,
  ReportingRule,
  SeriousnessDefinition,
  SubmissionFormat,
} from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { CreateFormSchemaDto } from './dto/create-form-schema.dto'
import { CreateReportingRuleDto } from './dto/create-reporting-rule.dto'
import { CreateSeriousnessDefinitionDto } from './dto/create-seriousness-definition.dto'
import { CreateSubmissionFormatDto } from './dto/create-submission-format.dto'
import { ListConfigQueryDto } from './dto/list-config-query.dto'

export interface RequestMeta {
  ip?: string
}

export interface AuthorityConfigNode {
  id: string
  code: string
  name: string
  reportTypes: {
    id: string
    typeKey: string
    name: string
    activeReportingRules: ReportingRule[]
    activeSeriousnessDefinitions: SeriousnessDefinition[]
    activeFormSchema: FormSchema | null
    activeSubmissionFormat: SubmissionFormat | null
  }[]
}

/**
 * The version-on-write pattern shared by all four config tables: there is
 * no UPDATE. `createVersion` always inserts a new `draft` row at
 * `(max existing version for this natural key) + 1`. `activate` is the
 * only thing that can make a row `active`, and it always retires whatever
 * was `active` before it for the same natural key, in the same
 * transaction, audited — so "one active version per key" (DB-enforced via
 * the phase4_1 partial unique indexes) and "audit trail of every config
 * change" both hold structurally, not just by convention.
 */
@Injectable()
export class CountryConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getConfigTree(countryId: string): Promise<AuthorityConfigNode[]> {
    const authorities = await this.prisma.regulatoryAuthority.findMany({ where: { countryId } })
    if (authorities.length === 0) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'No regulatory authority configured for this country',
      })
    }

    const reportTypes = await this.prisma.reportType.findMany({ orderBy: { name: 'asc' } })

    const nodes: AuthorityConfigNode[] = []
    for (const authority of authorities) {
      const node: AuthorityConfigNode = {
        id: authority.id,
        code: authority.code,
        name: authority.name,
        reportTypes: [],
      }

      for (const reportType of reportTypes) {
        const [
          activeReportingRules,
          activeSeriousnessDefinitions,
          activeFormSchema,
          activeSubmissionFormat,
        ] = await Promise.all([
          this.prisma.reportingRule.findMany({
            where: { authorityId: authority.id, reportTypeId: reportType.id, status: 'active' },
          }),
          this.prisma.seriousnessDefinition.findMany({
            where: { authorityId: authority.id, status: 'active' },
          }),
          this.resolveActiveFormSchema(countryId, reportType.id),
          this.prisma.submissionFormat.findFirst({
            where: { authorityId: authority.id, reportTypeId: reportType.id, status: 'active' },
          }),
        ])

        // testing-todo 18.3 (real-usage report, 19 Aug 2026) — this used to
        // `continue` (skip pushing the node) whenever a report type had no
        // *active* rule/format for this authority yet, on the theory that
        // "an active rule naming this authority" is the real signal for
        // whether a report type "belongs" to it (AEFI has an active Kenya
        // form schema, but AEFI is NVIP's report type, not PPB's). That
        // reasoning silently broke the entire "configure this report type
        // for the first time" flow: a brand-new authority (Gap 2's "Bring a
        // New Country Online") starts with zero active rules for every
        // report type, and `line_listing` specifically has no natural
        // authority binding at all (Stage 18: "not an incident report type
        // at all... exists purely so a ReportingRule row has somewhere to
        // carry reportingPeriodDays") — so its own row was invisible in the
        // UI under every authority, with no way to ever click into it and
        // create the first draft. The frontend already has a real empty
        // state for exactly this ("No active reporting window —
        // verification still pending"), so the fix is to always list every
        // report type, letting that empty state do its job instead of
        // hiding the row entirely.
        node.reportTypes.push({
          id: reportType.id,
          typeKey: reportType.typeKey,
          name: reportType.name,
          activeReportingRules,
          activeSeriousnessDefinitions,
          activeFormSchema,
          activeSubmissionFormat,
        })
      }

      nodes.push(node)
    }

    return nodes
  }

  private async resolveActiveFormSchema(
    countryId: string,
    reportTypeId: string,
  ): Promise<FormSchema | null> {
    const countrySpecific = await this.prisma.formSchema.findFirst({
      where: { countryId, reportTypeId, status: 'active' },
    })
    if (countrySpecific) return countrySpecific
    return this.prisma.formSchema.findFirst({
      where: { countryId: null, reportTypeId, status: 'active' },
    })
  }

  // ── Reporting rules ───────────────────────────────────────────────────

  async listReportingRules(query: ListConfigQueryDto): Promise<PaginatedResult<ReportingRule>> {
    const where: Prisma.ReportingRuleWhereInput = {
      ...(query.authorityId ? { authorityId: query.authorityId } : {}),
      ...(query.reportTypeId ? { reportTypeId: query.reportTypeId } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.reportingRule.findMany({
        where,
        orderBy: [
          { authorityId: 'asc' },
          { reportTypeId: 'asc' },
          { seriousnessClass: 'asc' },
          { version: 'desc' },
        ],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.reportingRule.count({ where }),
    ])
    return paginate(rows, total, query)
  }

  async createReportingRuleVersion(
    actor: AuthenticatedUser,
    dto: CreateReportingRuleDto,
    meta: RequestMeta,
  ): Promise<ReportingRule> {
    return this.prisma.$transaction(async (tx) => {
      const key = {
        authorityId: dto.authorityId,
        reportTypeId: dto.reportTypeId,
        seriousnessClass: dto.seriousnessClass,
      }
      const nextVersion = await this.nextVersion(tx.reportingRule, key)

      const created = await tx.reportingRule.create({
        data: {
          id: newId(),
          authorityId: dto.authorityId,
          reportTypeId: dto.reportTypeId,
          seriousnessClass: dto.seriousnessClass,
          windowDays: dto.windowDays,
          dayType: dto.dayType,
          clockStart: dto.clockStart,
          reportingPeriodDays: dto.reportingPeriodDays,
          submissionDestination: dto.submissionDestination ?? 'regulator',
          sourceReference: dto.sourceReference,
          unverified: dto.unverified ?? false,
          version: nextVersion,
          status: 'draft',
          effectiveFrom: new Date(dto.effectiveFrom),
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        action: 'reporting_rule_version_created',
        recordType: 'reporting_rule',
        recordId: created.id,
        newValue: {
          ...key,
          windowDays: dto.windowDays,
          version: nextVersion,
          unverified: created.unverified,
          submissionDestination: created.submissionDestination,
        },
        ip: meta.ip,
      })

      return created
    })
  }

  async activateReportingRule(
    actor: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<ReportingRule> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.reportingRule.findUniqueOrThrow({ where: { id } }).catch(() => {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Reporting rule version not found',
        })
      })
      if (target.unverified) {
        throw new BadRequestException({
          code: 'RULE_UNVERIFIED',
          message:
            'This rule is marked unverified and cannot be activated until confirmed against an authoritative source',
        })
      }
      this.assertDraft(target.status)

      const previousActive = await tx.reportingRule.findFirst({
        where: {
          authorityId: target.authorityId,
          reportTypeId: target.reportTypeId,
          seriousnessClass: target.seriousnessClass,
          status: 'active',
        },
      })
      if (previousActive) {
        await tx.reportingRule.update({
          where: { id: previousActive.id },
          data: { status: 'retired' },
        })
      }

      const activated = await tx.reportingRule.update({ where: { id }, data: { status: 'active' } })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        action: 'reporting_rule_activated',
        recordType: 'reporting_rule',
        recordId: id,
        oldValue: previousActive
          ? { activeVersionId: previousActive.id, version: previousActive.version }
          : undefined,
        newValue: { activeVersionId: activated.id, version: activated.version },
        ip: meta.ip,
      })

      return activated
    })
  }

  // ── Seriousness definitions ──────────────────────────────────────────

  async listSeriousnessDefinitions(
    query: ListConfigQueryDto,
  ): Promise<PaginatedResult<SeriousnessDefinition>> {
    const where: Prisma.SeriousnessDefinitionWhereInput = query.authorityId
      ? { authorityId: query.authorityId }
      : {}
    const [rows, total] = await Promise.all([
      this.prisma.seriousnessDefinition.findMany({
        where,
        orderBy: [{ authorityId: 'asc' }, { criterionKey: 'asc' }, { version: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.seriousnessDefinition.count({ where }),
    ])
    return paginate(rows, total, query)
  }

  async createSeriousnessDefinitionVersion(
    actor: AuthenticatedUser,
    dto: CreateSeriousnessDefinitionDto,
    meta: RequestMeta,
  ): Promise<SeriousnessDefinition> {
    return this.prisma.$transaction(async (tx) => {
      const key = { authorityId: dto.authorityId, criterionKey: dto.criterionKey }
      const nextVersion = await this.nextVersion(tx.seriousnessDefinition, key)

      const created = await tx.seriousnessDefinition.create({
        data: {
          id: newId(),
          ...key,
          label: dto.label,
          version: nextVersion,
          status: 'draft',
          effectiveFrom: new Date(dto.effectiveFrom),
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        action: 'seriousness_definition_version_created',
        recordType: 'seriousness_definition',
        recordId: created.id,
        newValue: { ...key, label: dto.label, version: nextVersion },
        ip: meta.ip,
      })

      return created
    })
  }

  async activateSeriousnessDefinition(
    actor: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<SeriousnessDefinition> {
    return this.prisma.$transaction(async (tx) => {
      const target = await this.findOrThrow(
        tx.seriousnessDefinition,
        id,
        'Seriousness definition version not found',
      )
      this.assertDraft(target.status)

      const previousActive = await tx.seriousnessDefinition.findFirst({
        where: {
          authorityId: target.authorityId,
          criterionKey: target.criterionKey,
          status: 'active',
        },
      })
      if (previousActive) {
        await tx.seriousnessDefinition.update({
          where: { id: previousActive.id },
          data: { status: 'retired' },
        })
      }

      const activated = await tx.seriousnessDefinition.update({
        where: { id },
        data: { status: 'active' },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        action: 'seriousness_definition_activated',
        recordType: 'seriousness_definition',
        recordId: id,
        oldValue: previousActive ? { activeVersionId: previousActive.id } : undefined,
        newValue: { activeVersionId: activated.id, version: activated.version },
        ip: meta.ip,
      })

      return activated
    })
  }

  // ── Form schemas ──────────────────────────────────────────────────────

  async listFormSchemas(query: ListConfigQueryDto): Promise<PaginatedResult<FormSchema>> {
    const where: Prisma.FormSchemaWhereInput = {
      ...(query.reportTypeId ? { reportTypeId: query.reportTypeId } : {}),
      ...(query.countryId ? { countryId: query.countryId } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.formSchema.findMany({
        where,
        orderBy: [{ reportTypeId: 'asc' }, { version: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.formSchema.count({ where }),
    ])
    return paginate(rows, total, query)
  }

  async createFormSchemaVersion(
    actor: AuthenticatedUser,
    dto: CreateFormSchemaDto,
    meta: RequestMeta,
  ): Promise<FormSchema> {
    return this.prisma.$transaction(async (tx) => {
      const key = { countryId: dto.countryId ?? null, reportTypeId: dto.reportTypeId }
      const nextVersion = await this.nextVersion(tx.formSchema, key)

      const created = await tx.formSchema.create({
        data: {
          id: newId(),
          countryId: key.countryId,
          reportTypeId: key.reportTypeId,
          jsonSchema: dto.jsonSchema as Prisma.InputJsonValue,
          officialFormCode: dto.officialFormCode,
          version: nextVersion,
          status: 'draft',
          effectiveFrom: new Date(dto.effectiveFrom),
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        action: 'form_schema_version_created',
        recordType: 'form_schema',
        recordId: created.id,
        newValue: { ...key, officialFormCode: dto.officialFormCode, version: nextVersion },
        ip: meta.ip,
      })

      return created
    })
  }

  async activateFormSchema(
    actor: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<FormSchema> {
    return this.prisma.$transaction(async (tx) => {
      const target = await this.findOrThrow(tx.formSchema, id, 'Form schema version not found')
      this.assertDraft(target.status)

      const previousActive = await tx.formSchema.findFirst({
        where: { countryId: target.countryId, reportTypeId: target.reportTypeId, status: 'active' },
      })
      if (previousActive) {
        await tx.formSchema.update({
          where: { id: previousActive.id },
          data: { status: 'retired' },
        })
      }

      const activated = await tx.formSchema.update({ where: { id }, data: { status: 'active' } })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        action: 'form_schema_activated',
        recordType: 'form_schema',
        recordId: id,
        oldValue: previousActive ? { activeVersionId: previousActive.id } : undefined,
        newValue: { activeVersionId: activated.id, version: activated.version },
        ip: meta.ip,
      })

      return activated
    })
  }

  // ── Submission formats ────────────────────────────────────────────────

  async listSubmissionFormats(
    query: ListConfigQueryDto,
  ): Promise<PaginatedResult<SubmissionFormat>> {
    const where: Prisma.SubmissionFormatWhereInput = {
      ...(query.authorityId ? { authorityId: query.authorityId } : {}),
      ...(query.reportTypeId ? { reportTypeId: query.reportTypeId } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.submissionFormat.findMany({
        where,
        orderBy: [{ authorityId: 'asc' }, { reportTypeId: 'asc' }, { version: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.submissionFormat.count({ where }),
    ])
    return paginate(rows, total, query)
  }

  async createSubmissionFormatVersion(
    actor: AuthenticatedUser,
    dto: CreateSubmissionFormatDto,
    meta: RequestMeta,
  ): Promise<SubmissionFormat> {
    return this.prisma.$transaction(async (tx) => {
      const key = { authorityId: dto.authorityId, reportTypeId: dto.reportTypeId }
      const nextVersion = await this.nextVersion(tx.submissionFormat, key)

      const created = await tx.submissionFormat.create({
        data: {
          id: newId(),
          ...key,
          templateRef: dto.templateRef,
          channel: dto.channel,
          version: nextVersion,
          status: 'draft',
          effectiveFrom: new Date(dto.effectiveFrom),
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        action: 'submission_format_version_created',
        recordType: 'submission_format',
        recordId: created.id,
        newValue: {
          ...key,
          templateRef: dto.templateRef,
          channel: dto.channel,
          version: nextVersion,
        },
        ip: meta.ip,
      })

      return created
    })
  }

  async activateSubmissionFormat(
    actor: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<SubmissionFormat> {
    return this.prisma.$transaction(async (tx) => {
      const target = await this.findOrThrow(
        tx.submissionFormat,
        id,
        'Submission format version not found',
      )
      this.assertDraft(target.status)

      const previousActive = await tx.submissionFormat.findFirst({
        where: {
          authorityId: target.authorityId,
          reportTypeId: target.reportTypeId,
          status: 'active',
        },
      })
      if (previousActive) {
        await tx.submissionFormat.update({
          where: { id: previousActive.id },
          data: { status: 'retired' },
        })
      }

      const activated = await tx.submissionFormat.update({
        where: { id },
        data: { status: 'active' },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        action: 'submission_format_activated',
        recordType: 'submission_format',
        recordId: id,
        oldValue: previousActive ? { activeVersionId: previousActive.id } : undefined,
        newValue: { activeVersionId: activated.id, version: activated.version },
        ip: meta.ip,
      })

      return activated
    })
  }

  // ── Shared helpers ─────────────────────────────────────────────────────

  private async nextVersion<Where extends Record<string, unknown>>(
    delegate: {
      findFirst: (args: {
        where: Where
        orderBy: { version: 'desc' }
      }) => Promise<{ version: number } | null>
    },
    where: Where,
  ): Promise<number> {
    const latest = await delegate.findFirst({ where, orderBy: { version: 'desc' } })
    return (latest?.version ?? 0) + 1
  }

  private async findOrThrow<T>(
    delegate: { findUnique: (args: { where: { id: string } }) => Promise<T | null> },
    id: string,
    message: string,
  ): Promise<T> {
    const row = await delegate.findUnique({ where: { id } })
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message })
    }
    return row
  }

  private assertDraft(status: ConfigStatus): void {
    if (status !== 'draft') {
      throw new ConflictException({
        code: 'NOT_DRAFT',
        message: 'Only a draft version can be activated',
      })
    }
  }
}
