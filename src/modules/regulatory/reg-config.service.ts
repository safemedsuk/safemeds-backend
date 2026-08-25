import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  ConfigStatus,
  Prisma,
  RegDeadlineRule,
  RegulatoryFeeSchedule,
  RegulatoryRequirement,
  RequiredDocumentDefinition,
} from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { CreateRegDeadlineRuleDto } from './dto/create-reg-deadline-rule.dto'
import { CreateRegulatoryFeeScheduleDto } from './dto/create-regulatory-fee-schedule.dto'
import { CreateRegulatoryRequirementDto } from './dto/create-regulatory-requirement.dto'
import { ListRegConfigQueryDto } from './dto/list-reg-config-query.dto'

export interface RequestMeta {
  ip?: string
}

export type RegulatoryRequirementWithDocs = RegulatoryRequirement & {
  documentDefinitions: RequiredDocumentDefinition[]
}

/**
 * RegCloud (Phase 12) Stage 0.1 — the country rule-set graph's own
 * version-on-write service, a direct structural copy of
 * `CountryConfigService`'s pattern (see that file's own doc comment): no
 * UPDATE exists anywhere here, `create*Version` always inserts a new
 * `draft` at `(max version for the natural key) + 1`, and `activate*` is
 * the only thing that can flip a row to `active` — always retiring
 * whatever was active before it, in the same transaction, audited both
 * ways. "One active version per natural key" is enforced by the
 * hand-added partial unique indexes in this migration's own `.sql` file
 * (Prisma's schema language can't express one directly), not just by this
 * service's own discipline.
 */
@Injectable()
export class RegConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // ── Regulatory requirements (+ their document checklist) ────────────────

  async listRequirements(
    query: ListRegConfigQueryDto,
  ): Promise<PaginatedResult<RegulatoryRequirementWithDocs>> {
    const where: Prisma.RegulatoryRequirementWhereInput = {
      ...(query.countryId ? { countryId: query.countryId } : {}),
      ...(query.authorityId ? { authorityId: query.authorityId } : {}),
      // Includes the `"*"` (all-classes) wildcard alongside an exact match —
      // found via real browser verification: creating a wildcard row from a
      // specific-class-scoped screen (the "apply to every product class"
      // checkbox) made it vanish from that same screen's own list the
      // moment the create form closed, since the list only ever matched the
      // exact class. Mirrors `resolveRequirement()`/`resolveDeadlineRule()`'s
      // own route/class fallback — a list should show everything a real
      // lookup for this class would actually resolve against.
      ...(query.productClass ? { productClass: { in: [query.productClass, '*'] } } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.regulatoryRequirement.findMany({
        where,
        include: { documentDefinitions: { orderBy: { sortOrder: 'asc' } } },
        orderBy: [
          { countryId: 'asc' },
          { authorityId: 'asc' },
          { productClass: 'asc' },
          { version: 'desc' },
        ],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.regulatoryRequirement.count({ where }),
    ])
    return paginate(rows, total, query)
  }

  async createRequirementVersion(
    actor: AuthenticatedUser,
    dto: CreateRegulatoryRequirementDto,
    meta: RequestMeta,
  ): Promise<RegulatoryRequirementWithDocs> {
    return this.prisma.$transaction(async (tx) => {
      const key = {
        countryId: dto.countryId,
        authorityId: dto.authorityId,
        productClass: dto.productClass,
        route: dto.route ?? '*',
      }
      const latest = await tx.regulatoryRequirement.findFirst({
        where: key,
        orderBy: { version: 'desc' },
      })
      const nextVersion = (latest?.version ?? 0) + 1

      const created = await tx.regulatoryRequirement.create({
        data: {
          id: newId(),
          ...key,
          standardTimelineDays: dto.standardTimelineDays,
          description: dto.description,
          unverified: dto.unverified ?? true,
          sourceReference: dto.sourceReference,
          version: nextVersion,
          status: 'draft',
          effectiveFrom: new Date(dto.effectiveFrom),
        },
      })

      const documentDefinitions = dto.documentDefinitions ?? []
      if (documentDefinitions.length > 0) {
        await tx.requiredDocumentDefinition.createMany({
          data: documentDefinitions.map((d, index) => ({
            id: newId(),
            regulatoryRequirementId: created.id,
            documentKey: d.documentKey,
            name: d.name,
            ctdModule: d.ctdModule,
            isMandatory: d.isMandatory ?? true,
            sourceReference: d.sourceReference,
            sortOrder: d.sortOrder ?? index,
          })),
        })
      }

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        action: 'regulatory_requirement_version_created',
        recordType: 'regulatory_requirement',
        recordId: created.id,
        newValue: {
          ...key,
          version: nextVersion,
          unverified: created.unverified,
          documentCount: documentDefinitions.length,
        },
        ip: meta.ip,
      })

      const withDocs = await tx.regulatoryRequirement.findUniqueOrThrow({
        where: { id: created.id },
        include: { documentDefinitions: { orderBy: { sortOrder: 'asc' } } },
      })
      return withDocs
    })
  }

  async activateRequirement(
    actor: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<RegulatoryRequirement> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.regulatoryRequirement.findUnique({ where: { id } })
      if (!target)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Regulatory requirement version not found',
        })
      if (target.unverified) {
        throw new BadRequestException({
          code: 'RULE_UNVERIFIED',
          message:
            'This requirement is marked unverified and cannot be activated until confirmed against an authoritative source',
        })
      }
      this.assertDraft(target.status)

      const previousActive = await tx.regulatoryRequirement.findFirst({
        where: {
          countryId: target.countryId,
          authorityId: target.authorityId,
          productClass: target.productClass,
          route: target.route,
          status: 'active',
        },
      })
      if (previousActive) {
        await tx.regulatoryRequirement.update({
          where: { id: previousActive.id },
          data: { status: 'retired' },
        })
      }

      const activated = await tx.regulatoryRequirement.update({
        where: { id },
        data: { status: 'active' },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        action: 'regulatory_requirement_activated',
        recordType: 'regulatory_requirement',
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

  // ── Fee schedules ─────────────────────────────────────────────────────

  async listFeeSchedules(
    query: ListRegConfigQueryDto,
  ): Promise<PaginatedResult<RegulatoryFeeSchedule>> {
    const where: Prisma.RegulatoryFeeScheduleWhereInput = {
      ...(query.countryId ? { countryId: query.countryId } : {}),
      ...(query.authorityId ? { authorityId: query.authorityId } : {}),
      // Includes the `"*"` (all-classes) wildcard alongside an exact match —
      // found via real browser verification: creating a wildcard row from a
      // specific-class-scoped screen (the "apply to every product class"
      // checkbox) made it vanish from that same screen's own list the
      // moment the create form closed, since the list only ever matched the
      // exact class. Mirrors `resolveRequirement()`/`resolveDeadlineRule()`'s
      // own route/class fallback — a list should show everything a real
      // lookup for this class would actually resolve against.
      ...(query.productClass ? { productClass: { in: [query.productClass, '*'] } } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.regulatoryFeeSchedule.findMany({
        where,
        orderBy: [
          { countryId: 'asc' },
          { authorityId: 'asc' },
          { productClass: 'asc' },
          { feeType: 'asc' },
          { version: 'desc' },
        ],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.regulatoryFeeSchedule.count({ where }),
    ])
    return paginate(rows, total, query)
  }

  async createFeeScheduleVersion(
    actor: AuthenticatedUser,
    dto: CreateRegulatoryFeeScheduleDto,
    meta: RequestMeta,
  ): Promise<RegulatoryFeeSchedule> {
    return this.prisma.$transaction(async (tx) => {
      const key = {
        countryId: dto.countryId,
        authorityId: dto.authorityId,
        productClass: dto.productClass,
        route: dto.route ?? '*',
        feeType: dto.feeType,
      }
      const latest = await tx.regulatoryFeeSchedule.findFirst({
        where: key,
        orderBy: { version: 'desc' },
      })
      const nextVersion = (latest?.version ?? 0) + 1

      const created = await tx.regulatoryFeeSchedule.create({
        data: {
          id: newId(),
          ...key,
          amount: dto.amount,
          currency: dto.currency ?? 'KES',
          unverified: dto.unverified ?? true,
          sourceReference: dto.sourceReference,
          version: nextVersion,
          status: 'draft',
          effectiveFrom: new Date(dto.effectiveFrom),
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        action: 'regulatory_fee_schedule_version_created',
        recordType: 'regulatory_fee_schedule',
        recordId: created.id,
        newValue: {
          ...key,
          amount: dto.amount,
          currency: created.currency,
          version: nextVersion,
          unverified: created.unverified,
        },
        ip: meta.ip,
      })

      return created
    })
  }

  async activateFeeSchedule(
    actor: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<RegulatoryFeeSchedule> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.regulatoryFeeSchedule.findUnique({ where: { id } })
      if (!target)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Fee schedule version not found',
        })
      if (target.unverified) {
        throw new BadRequestException({
          code: 'RULE_UNVERIFIED',
          message:
            'This fee schedule is marked unverified and cannot be activated until confirmed against an authoritative source',
        })
      }
      this.assertDraft(target.status)

      const previousActive = await tx.regulatoryFeeSchedule.findFirst({
        where: {
          countryId: target.countryId,
          authorityId: target.authorityId,
          productClass: target.productClass,
          route: target.route,
          feeType: target.feeType,
          status: 'active',
        },
      })
      if (previousActive) {
        await tx.regulatoryFeeSchedule.update({
          where: { id: previousActive.id },
          data: { status: 'retired' },
        })
      }

      const activated = await tx.regulatoryFeeSchedule.update({
        where: { id },
        data: { status: 'active' },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        action: 'regulatory_fee_schedule_activated',
        recordType: 'regulatory_fee_schedule',
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

  // ── Resolution — read-only, no side effects, mirrors `RuleResolutionService` ──

  /**
   * Resolves the active, non-unverified requirement for an exact
   * `(countryId, authorityId, productClass, route)` — falling back to the
   * `"*"` route sentinel if no route-specific row is active, so a graph
   * configured only "for all routes" still resolves for a request that
   * names a specific one. Returns `null` (never throws, never guesses) if
   * nothing active exists yet — the honest "not yet configured for this
   * market" state every resolution method in this codebase returns.
   */
  async resolveRequirement(
    countryId: string,
    authorityId: string,
    productClass: string,
    route: string,
  ): Promise<RegulatoryRequirementWithDocs | null> {
    const specific = await this.prisma.regulatoryRequirement.findFirst({
      where: { countryId, authorityId, productClass, route, status: 'active' },
      include: { documentDefinitions: { orderBy: { sortOrder: 'asc' } } },
    })
    if (specific) return specific
    if (route === '*') return null

    return this.prisma.regulatoryRequirement.findFirst({
      where: { countryId, authorityId, productClass, route: '*', status: 'active' },
      include: { documentDefinitions: { orderBy: { sortOrder: 'asc' } } },
    })
  }

  /** Every active, non-retired fee row matching the key — a class can carry several fee types (application/variation/renewal/annual) at once, so this is always a list, never a single row. */
  async resolveFeeSchedules(
    countryId: string,
    authorityId: string,
    productClass: string,
    route: string,
  ): Promise<RegulatoryFeeSchedule[]> {
    const [specific, wildcard] = await Promise.all([
      this.prisma.regulatoryFeeSchedule.findMany({
        where: { countryId, authorityId, productClass, route, status: 'active' },
      }),
      route === '*'
        ? Promise.resolve([])
        : this.prisma.regulatoryFeeSchedule.findMany({
            where: { countryId, authorityId, productClass, route: '*', status: 'active' },
          }),
    ])
    const specificFeeTypes = new Set(specific.map((r) => r.feeType))
    return [...specific, ...wildcard.filter((r) => !specificFeeTypes.has(r.feeType))]
  }

  // ── Deadline rules (Stage 0.4) ────────────────────────────────────────
  // Owned here alongside the requirement/fee-schedule graph — same
  // version-on-write mechanics, same natural-key shape — while the actual
  // due-date *computation* engine (`RegDeadlineService`) only ever
  // consumes `resolveDeadlineRule()` below, mirroring how `DeadlineService`
  // consumes `RuleResolutionService.resolveReportingRule()` rather than
  // owning `ReportingRule`'s own CRUD.

  async listDeadlineRules(query: ListRegConfigQueryDto): Promise<PaginatedResult<RegDeadlineRule>> {
    const where: Prisma.RegDeadlineRuleWhereInput = {
      ...(query.countryId ? { countryId: query.countryId } : {}),
      ...(query.authorityId ? { authorityId: query.authorityId } : {}),
      // Includes the `"*"` (all-classes) wildcard alongside an exact match —
      // found via real browser verification: creating a wildcard row from a
      // specific-class-scoped screen (the "apply to every product class"
      // checkbox) made it vanish from that same screen's own list the
      // moment the create form closed, since the list only ever matched the
      // exact class. Mirrors `resolveRequirement()`/`resolveDeadlineRule()`'s
      // own route/class fallback — a list should show everything a real
      // lookup for this class would actually resolve against.
      ...(query.productClass ? { productClass: { in: [query.productClass, '*'] } } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.regDeadlineRule.findMany({
        where,
        orderBy: [
          { countryId: 'asc' },
          { authorityId: 'asc' },
          { obligationType: 'asc' },
          { version: 'desc' },
        ],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.regDeadlineRule.count({ where }),
    ])
    return paginate(rows, total, query)
  }

  async createDeadlineRuleVersion(
    actor: AuthenticatedUser,
    dto: CreateRegDeadlineRuleDto,
    meta: RequestMeta,
  ): Promise<RegDeadlineRule> {
    return this.prisma.$transaction(async (tx) => {
      const key = {
        countryId: dto.countryId,
        authorityId: dto.authorityId,
        productClass: dto.productClass ?? '*',
        obligationType: dto.obligationType,
      }
      const latest = await tx.regDeadlineRule.findFirst({
        where: key,
        orderBy: { version: 'desc' },
      })
      const nextVersion = (latest?.version ?? 0) + 1

      const created = await tx.regDeadlineRule.create({
        data: {
          id: newId(),
          ...key,
          intervalValue: dto.intervalValue,
          intervalUnit: dto.intervalUnit,
          clockStart: dto.clockStart ?? 'issued_on',
          unverified: dto.unverified ?? true,
          sourceReference: dto.sourceReference,
          version: nextVersion,
          status: 'draft',
          effectiveFrom: new Date(dto.effectiveFrom),
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        action: 'reg_deadline_rule_version_created',
        recordType: 'reg_deadline_rule',
        recordId: created.id,
        newValue: {
          ...key,
          intervalValue: dto.intervalValue,
          intervalUnit: dto.intervalUnit,
          version: nextVersion,
          unverified: created.unverified,
        },
        ip: meta.ip,
      })

      return created
    })
  }

  async activateDeadlineRule(
    actor: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<RegDeadlineRule> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.regDeadlineRule.findUnique({ where: { id } })
      if (!target)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Deadline rule version not found',
        })
      if (target.unverified) {
        throw new BadRequestException({
          code: 'RULE_UNVERIFIED',
          message:
            'This deadline rule is marked unverified and cannot be activated until confirmed against an authoritative source',
        })
      }
      this.assertDraft(target.status)

      const previousActive = await tx.regDeadlineRule.findFirst({
        where: {
          countryId: target.countryId,
          authorityId: target.authorityId,
          productClass: target.productClass,
          obligationType: target.obligationType,
          status: 'active',
        },
      })
      if (previousActive) {
        await tx.regDeadlineRule.update({
          where: { id: previousActive.id },
          data: { status: 'retired' },
        })
      }

      const activated = await tx.regDeadlineRule.update({
        where: { id },
        data: { status: 'active' },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        action: 'reg_deadline_rule_activated',
        recordType: 'reg_deadline_rule',
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

  /**
   * Falls back to the `"*"` product-class sentinel exactly like
   * `resolveRequirement()` falls back on route — Kenya's real 5-year
   * renewal rule is seeded against `"*"` (applies to every class), so a
   * lookup for any specific class still resolves it.
   */
  async resolveDeadlineRule(
    countryId: string,
    authorityId: string,
    productClass: string,
    obligationType: string,
  ): Promise<RegDeadlineRule | null> {
    const specific = await this.prisma.regDeadlineRule.findFirst({
      where: { countryId, authorityId, productClass, obligationType, status: 'active' },
    })
    if (specific) return specific
    if (productClass === '*') return null
    return this.prisma.regDeadlineRule.findFirst({
      where: { countryId, authorityId, productClass: '*', obligationType, status: 'active' },
    })
  }

  /**
   * RegCloud (Phase 12) Stage 8 — every active `RegDeadlineRule`
   * `obligationType` resolvable for a given registration, one row per
   * type (a specific-class rule always wins over the `"*"` wildcard for
   * the same `obligationType`, exactly like `resolveDeadlineRule()`'s
   * own single-type fallback). `RegPostMarketObligationService` uses
   * this to discover which recurring obligation cycles a registration
   * should actually be tracking, without hardcoding a fixed obligation
   * list anywhere in code — whatever a platform admin configures and
   * activates here is what shows up, nothing more, nothing guessed.
   */
  async listActiveDeadlineRulesByObligationType(
    countryId: string,
    authorityId: string,
    productClass: string,
  ): Promise<RegDeadlineRule[]> {
    const rows = await this.prisma.regDeadlineRule.findMany({
      where: {
        countryId,
        authorityId,
        status: 'active',
        productClass: { in: [productClass, '*'] },
      },
    })
    const byType = new Map<string, RegDeadlineRule>()
    for (const row of rows) {
      const existing = byType.get(row.obligationType)
      if (!existing || (existing.productClass === '*' && row.productClass !== '*')) {
        byType.set(row.obligationType, row)
      }
    }
    return [...byType.values()]
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
