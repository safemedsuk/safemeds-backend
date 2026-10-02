import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { RegDossier, RegDossierDocumentSlot } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { LocationScopeService } from '../tenancy/location-scope.service'
import { WorkflowService } from '../workflow/workflow.service'
import { CompletenessGateResult, CompletenessGateService } from './completeness-gate.service'
import { AttachDossierDocumentDto } from './dto/attach-dossier-document.dto'
import { CreateDossierSlotDto } from './dto/create-dossier-slot.dto'
import { CreateRegDossierDto } from './dto/create-reg-dossier.dto'
import { ListRegDossiersQueryDto } from './dto/list-reg-dossiers-query.dto'
import { EngagementModelService, EngagementType } from './engagement-model.service'
import { RegConfigService } from './reg-config.service'

export interface RequestMeta {
  ip?: string
}

export type RegDossierWithSlots = RegDossier & {
  documentSlots: RegDossierDocumentSlot[]
  product: { brandName: string }
  authority: { name: string; code: string }
}

export interface TransitionLogEntry {
  fromStateKey: string | null
  toStateKey: string
  note: string | null
  actorName: string | null
  occurredAt: Date
}

export interface RegVariationSummary {
  id: string
  variationType: string
  displayCode: string
  productRegistrationId: string
  productRegistrationNumber: string
}

/** testing-correction-explanation.md §2.5 — the Regulatory Dossiers list's own "Kind" column. Derived the same way `CompletenessGateService`'s `guidanceOnly` flag already is: no wrapping `RegVariation` → `registration`; wrapped, `variationType: 'renewal'` → `renewal`; wrapped, anything else → `variation`. */
export type RegDossierKind = 'registration' | 'variation' | 'renewal'

export type RegDossierListRow = RegDossierWithSlots & {
  kind: RegDossierKind
  variation: RegVariationSummary | null
}

export type RegDossierDetail = RegDossierWithSlots & {
  workflowInstanceId: string | null
  completeness: CompletenessGateResult
  transitionHistory: TransitionLogEntry[]
  /** RegCloud Stage 7 — set only when this dossier is wrapped by a `RegVariation` (a variation/renewal of an existing registration), for the detail page's own header display. Null for a from-scratch registration dossier. */
  variation: RegVariationSummary | null
  /** testing-correction-explanation.md §2.3/§2.5 — drives the detail page's own stage tracker labels; see `RegDossierListRow.kind`'s own doc comment for how it's derived. */
  kind: RegDossierKind
  /** RegCloud Stage 15 — this dossier's own override resolved against the company's default; see `EngagementModelService.resolveEffective()`. */
  effectiveEngagementType: EngagementType
}

/**
 * RegCloud (Phase 12) Stage 1 — the workflow's own record type. A
 * separate literal-value constant from `REG_REGISTRATION_WORKFLOW_RECORD_TYPE`
 * in `prisma/workflow.seed-data.ts`, matching the existing (if slightly
 * duplicative) `PV_CASE_RECORD_TYPE`/`PV_CASE_WORKFLOW_RECORD_TYPE`
 * precedent exactly — both must always agree on the string `"reg_registration"`.
 */
export const REG_REGISTRATION_RECORD_TYPE = 'reg_registration'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A dossier is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * RegCloud (Phase 12) Stage 0.3 — Document Custody & Dossier Assembly,
 * now also carrying Stage 1 (Classify & Plan) and Stage 2 (Compile
 * Dossier): `create()` both resolves the classification graph (Stage 1)
 * and instantiates a real `reg_registration` workflow at `planning`
 * (`WorkflowService`), and `attachDocument()`/`detachDocument()` are the
 * exact same "compile the dossier" mechanics Stage 2's own build-spec
 * bullet asks for — no separate compilation service was needed, this one
 * already did the work. `Document`/`DocumentVersion` are reused entirely
 * unchanged (see the schema's own `Document.regDossierSlotFor` relation)
 * — no new storage mechanism, attaching a document to a slot is just
 * writing an existing `Document.id` onto `RegDossierDocumentSlot.documentId`.
 * `get()` additionally surfaces the live workflow state, Stage 3's
 * completeness-gate result, and the transition history — the same
 * "one record detail response, several stages' worth of sections"
 * shape `PvCaseService.get()`/`SignalService.get()` already established.
 */
@Injectable()
export class RegDossierService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly regConfigService: RegConfigService,
    private readonly locationScopeService: LocationScopeService,
    private readonly workflowService: WorkflowService,
    private readonly completenessGateService: CompletenessGateService,
    private readonly engagementModelService: EngagementModelService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListRegDossiersQueryDto,
  ): Promise<PaginatedResult<RegDossierListRow>> {
    const companyId = requireCompany(actor)
    // RegCloud (Phase 12) Stage 0.6 — same `countryIds` composition as
    // `MasterDataService.listRegistrations()`; a dossier's own country
    // dimension is `authorityId → countryId` too.
    const access = await this.locationScopeService.getEffectiveAccess(
      companyId,
      actor.sub,
      actor.roleKeys,
    )
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = {
        companyId,
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.clinicalTrialId ? { clinicalTrialId: query.clinicalTrialId } : {}),
        ...(query.relianceApplicationId
          ? { relianceApplicationId: query.relianceApplicationId }
          : {}),
        ...(access.unrestricted ? {} : { authority: { countryId: { in: access.countryIds } } }),
      }
      const [rows, total] = await Promise.all([
        tx.regDossier.findMany({
          where,
          include: {
            documentSlots: true,
            product: { select: { brandName: true } },
            authority: { select: { name: true, code: true } },
            // testing-correction-explanation.md §2.5 — the list's own new
            // "Kind" column needs the same wrapping-RegVariation signal
            // `get()`/`CompletenessGateService` already use.
            regVariation: {
              include: { productRegistration: { select: { registrationNumber: true } } },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.regDossier.count({ where }),
      ])
      const withKind: RegDossierListRow[] = rows.map(({ regVariation, ...dossier }) => {
        const variation: RegVariationSummary | null = regVariation
          ? {
              id: regVariation.id,
              variationType: regVariation.variationType,
              displayCode: regVariation.displayCode,
              productRegistrationId: regVariation.productRegistrationId,
              productRegistrationNumber: regVariation.productRegistration.registrationNumber,
            }
          : null
        const kind: RegDossierKind = !variation
          ? 'registration'
          : variation.variationType === 'renewal'
            ? 'renewal'
            : 'variation'
        return { ...dossier, kind, variation }
      })
      return paginate(withKind, total, query)
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<RegDossierDetail> {
    const companyId = requireCompany(actor)
    const dossier = await this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.regDossier.findUnique({
        where: { id },
        include: {
          documentSlots: true,
          product: { select: { brandName: true } },
          authority: { select: { name: true, code: true } },
        },
      })
      if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Dossier not found' })

      const [workflowInstance, completeness, variationRow, effectiveEngagementType] =
        await Promise.all([
          tx.workflowInstance.findFirst({
            where: { recordType: REG_REGISTRATION_RECORD_TYPE, recordId: id },
            include: { currentState: true },
          }),
          this.completenessGateService.evaluateInTx(tx, id),
          tx.regVariation.findFirst({
            where: { regDossierId: id },
            include: { productRegistration: { select: { registrationNumber: true } } },
          }),
          this.engagementModelService.resolveEffective(tx, companyId, id),
        ])

      const variation: RegVariationSummary | null = variationRow
        ? {
            id: variationRow.id,
            variationType: variationRow.variationType,
            displayCode: variationRow.displayCode,
            productRegistrationId: variationRow.productRegistrationId,
            productRegistrationNumber: variationRow.productRegistration.registrationNumber,
          }
        : null

      const kind: RegDossierKind = !variation
        ? 'registration'
        : variation.variationType === 'renewal'
          ? 'renewal'
          : 'variation'

      return {
        ...found,
        // `RegDossier.status` is kept in sync by `RegWorkflowGuards`' own
        // status-sync registration on every real transition, but the
        // live `WorkflowInstance` is still the source of truth for a
        // freshly-instantiated dossier that hasn't transitioned yet —
        // same reconciliation `PvCaseService.get()`/`SignalService.get()`
        // already established.
        status: workflowInstance?.currentState.stateKey ?? found.status,
        workflowInstanceId: workflowInstance?.id ?? null,
        completeness,
        variation,
        kind,
        effectiveEngagementType,
      }
    })

    const historyPage = await this.auditService.query(actor, {
      recordType: REG_REGISTRATION_RECORD_TYPE,
      recordId: id,
      action: 'state_change',
      page: 1,
      limit: 50,
    })
    const transitionHistory: TransitionLogEntry[] = historyPage.data.map((entry) => {
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

    return { ...dossier, transitionHistory }
  }

  /** A lighter-weight, standalone read of just the completeness result — lets the FE re-check after an attach/detach without a full dossier reload. */
  async getCompleteness(actor: AuthenticatedUser, id: string): Promise<CompletenessGateResult> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const exists = await tx.regDossier.findUnique({ where: { id }, select: { id: true } })
      if (!exists) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Dossier not found' })
      return this.completenessGateService.evaluateInTx(tx, id)
    })
  }

  /**
   * Creates the dossier and, if an active `RegulatoryRequirement` resolves
   * for the given country/authority/class/route, pre-populates one slot per
   * checklist item (`RequiredDocumentDefinition`) — unattached, ready for
   * `attachDocument()` to fill in. If nothing resolves yet (an
   * unconfigured market), the dossier is still created with zero slots —
   * graceful degradation, never a blocked create, matching every other
   * `resolve*` consumer in this codebase.
   */
  /**
   * `productRegistrationId` is deliberately **not** a field on
   * `CreateRegDossierDto` — it can never be set by a raw HTTP call to
   * this endpoint, only by `RegVariationService.create()` calling this
   * method directly in-process, after it has already verified the
   * target registration is real and company-scoped. See `RegVariation`'s
   * own schema doc comment for why a variation's dossier is created the
   * exact same way an initial registration's is, differing only in this
   * one pre-set value.
   */
  async create(
    actor: AuthenticatedUser,
    dto: CreateRegDossierDto,
    meta: RequestMeta,
    productRegistrationId?: string,
  ): Promise<RegDossierWithSlots> {
    const companyId = requireCompany(actor)
    const route = dto.route ?? '*'

    return this.rls.runAsCompany(companyId, async (tx) => {
      const product = await tx.product.findUnique({ where: { id: dto.productId } })
      if (!product) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' })

      const authority = await tx.regulatoryAuthority.findUnique({ where: { id: dto.authorityId } })
      if (!authority)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Regulatory authority not found',
        })

      // RegCloud Stage 12 — a CTA dossier's trial must be a real trial
      // belonging to this same company; RLS on `clinicalTrial` (company-
      // scoped) already guarantees this lookup can't cross tenants.
      if (dto.clinicalTrialId) {
        const trial = await tx.clinicalTrial.findUnique({ where: { id: dto.clinicalTrialId } })
        if (!trial)
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Clinical trial not found' })
      }

      // RegCloud Stage 16 — a reliance-pathway dossier's own application
      // must be a real one belonging to this same company; RLS on
      // `relianceApplication` already guarantees this can't cross tenants.
      if (dto.relianceApplicationId) {
        const application = await tx.relianceApplication.findUnique({
          where: { id: dto.relianceApplicationId },
        })
        if (!application)
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: 'Reliance application not found',
          })
      }

      // `RegConfigService.resolveRequirement` reads the global rule-set
      // graph via a bare `PrismaService` (no RLS — those tables have no
      // `companyId` at all, see that service's own doc comment), so it's
      // safe to call here even though this transaction is RLS-scoped.
      const requirement = await this.regConfigService.resolveRequirement(
        authority.countryId,
        dto.authorityId,
        dto.productClass,
        route,
      )

      const created = await tx.regDossier.create({
        data: {
          id: newId(),
          companyId,
          productId: dto.productId,
          authorityId: dto.authorityId,
          productClass: dto.productClass,
          route,
          regulatoryRequirementId: requirement?.id,
          productRegistrationId,
          clinicalTrialId: dto.clinicalTrialId,
          relianceApplicationId: dto.relianceApplicationId,
          engagementType: dto.engagementType,
          // Stage 1 — the workflow's own initial state. Kept in sync with
          // `REG_REGISTRATION_WORKFLOW_STATES[0].key` (`prisma/workflow.seed-data.ts`)
          // by convention, same as `Case.status` starting at `'intake'`.
          status: 'planning',
          createdBy: actor.sub,
        },
      })

      if (requirement && requirement.documentDefinitions.length > 0) {
        await tx.regDossierDocumentSlot.createMany({
          data: requirement.documentDefinitions.map((d) => ({
            id: newId(),
            regDossierId: created.id,
            requiredDocumentDefinitionId: d.id,
            ctdModule: d.ctdModule,
          })),
        })
      }

      // Stage 1 — every dossier is a real workflow instance from the
      // moment it's created, starting at `planning`. Called from inside
      // this same RLS-bound transaction, matching `PvCaseService.create()`'s
      // own established precedent for calling `workflowService.instantiate()`
      // mid-transaction rather than after it commits.
      await this.workflowService.instantiate(
        actor,
        REG_REGISTRATION_RECORD_TYPE,
        created.id,
        authority.countryId,
        meta,
      )

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'reg_dossier_created',
        recordType: 'reg_dossier',
        recordId: created.id,
        newValue: {
          productId: dto.productId,
          authorityId: dto.authorityId,
          productClass: dto.productClass,
          route,
          resolvedRequirementId: requirement?.id ?? null,
          slotsCreated: requirement?.documentDefinitions.length ?? 0,
          clinicalTrialId: dto.clinicalTrialId ?? null,
          relianceApplicationId: dto.relianceApplicationId ?? null,
          engagementType: dto.engagementType ?? null,
        },
        ip: meta.ip,
      })

      const withSlots = await tx.regDossier.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          documentSlots: true,
          product: { select: { brandName: true } },
          authority: { select: { name: true, code: true } },
        },
      })
      return withSlots
    })
  }

  /** An ad-hoc slot for a document the checklist didn't anticipate. */
  async addSlot(
    actor: AuthenticatedUser,
    dossierId: string,
    dto: CreateDossierSlotDto,
    meta: RequestMeta,
  ): Promise<RegDossierDocumentSlot> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const dossier = await tx.regDossier.findUnique({ where: { id: dossierId } })
      if (!dossier) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Dossier not found' })

      const created = await tx.regDossierDocumentSlot.create({
        data: {
          id: newId(),
          regDossierId: dossierId,
          labelOverride: dto.labelOverride,
          ctdModule: dto.ctdModule,
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'reg_dossier_slot_added',
        recordType: 'reg_dossier',
        recordId: dossierId,
        newValue: { slotId: created.id, labelOverride: dto.labelOverride },
        ip: meta.ip,
      })
      return created
    })
  }

  async attachDocument(
    actor: AuthenticatedUser,
    dossierId: string,
    slotId: string,
    dto: AttachDossierDocumentDto,
    meta: RequestMeta,
  ): Promise<RegDossierDocumentSlot> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const slot = await tx.regDossierDocumentSlot.findUnique({ where: { id: slotId } })
      if (!slot || slot.regDossierId !== dossierId)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Dossier slot not found' })

      // RLS on `document` (company-scoped) means this lookup only ever
      // finds a document belonging to the acting company — a cross-tenant
      // documentId simply resolves to nothing, matching every other
      // "attach an existing record" pattern in this codebase.
      const document = await tx.document.findUnique({ where: { id: dto.documentId } })
      if (!document)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Document not found' })

      const updated = await tx.regDossierDocumentSlot.update({
        where: { id: slotId },
        data: { documentId: dto.documentId },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'reg_dossier_document_attached',
        recordType: 'reg_dossier',
        recordId: dossierId,
        newValue: { slotId, documentId: dto.documentId },
        ip: meta.ip,
      })
      return updated
    })
  }

  async detachDocument(
    actor: AuthenticatedUser,
    dossierId: string,
    slotId: string,
    meta: RequestMeta,
  ): Promise<RegDossierDocumentSlot> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const slot = await tx.regDossierDocumentSlot.findUnique({ where: { id: slotId } })
      if (!slot || slot.regDossierId !== dossierId)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Dossier slot not found' })

      const updated = await tx.regDossierDocumentSlot.update({
        where: { id: slotId },
        data: { documentId: null },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'reg_dossier_document_detached',
        recordType: 'reg_dossier',
        recordId: dossierId,
        oldValue: { slotId, documentId: slot.documentId },
        ip: meta.ip,
      })
      return updated
    })
  }
}
