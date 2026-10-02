import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, RegVariation, RegVariationType } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { CreateRegVariationDto } from './dto/create-reg-variation.dto'
import { RegDossierService, RegDossierWithSlots } from './reg-dossier.service'

export interface RequestMeta {
  ip?: string
}

const REG_REGISTRATION_RECORD_TYPE = 'reg_registration'
const REG_VARIATION_RECORD_TYPE = 'reg_variation'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A variation is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * RegCloud (Phase 12) Stage 7 — Lifecycle: Variations & Renewals. Folds
 * a renewal into this same model as `variationType: 'renewal'`, per the
 * todo's own offered resolution, rather than a second parallel table.
 * Deliberately reuses **all** of Stage 1–6's own machinery rather than a
 * parallel one: `create()` calls the exact same `RegDossierService.create()`
 * every fresh registration uses, just with `productRegistrationId`
 * pre-set — that one pre-set value is what `RegWorkflowGuards`' own
 * status-sync function reads at `→ approved` to update the existing
 * registration instead of creating a new one (see `RegVariation`'s own
 * schema doc comment for the full reasoning). `productId`/`authorityId`/
 * `productClass`/`route` all default to the *target registration's own*
 * current values when not explicitly overridden — a variation is, by
 * default, "the same registration, revised," not a from-scratch
 * classification decision.
 *
 * **A real, deliberate two-step sequence, not one atomic transaction**:
 * the dossier is created first (`RegDossierService.create()`, its own
 * transaction — resolves the classification graph and instantiates a
 * real workflow), then this `RegVariation` wrapper row is created
 * immediately after, in a second, fast, DB-only transaction. Matches
 * this project's own established tolerance for "sequential-but-safe
 * suffices" (VigiCloud Stage 12's own PDF-generation-then-DB-write
 * split) — true single-transaction atomicity here would mean
 * duplicating `RegDossierService.create()`'s own requirement-resolution
 * and slot-population logic rather than reusing it, a worse tradeoff
 * than accepting the small, DB-error-only risk of an orphaned dossier
 * if the second step fails.
 *
 * testing-correction-explanation.md §2.2/§3.1 — the same second
 * transaction also fast-forwards the freshly-instantiated workflow
 * instance past `planning` straight to `variation_application` (any
 * type except `renewal`) or `renewal_requested` (`renewal`) — a direct,
 * system-owned `WorkflowInstance` override, the established pattern for
 * "a legitimate system trigger with no normal role/signature-gated
 * transition to go through" (VigiCloud's `reopenCaseToTriage()`), never
 * a new generic capability on `WorkflowService` itself.
 */
@Injectable()
export class RegVariationService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly regDossierService: RegDossierService,
    private readonly documentsService: DocumentsService,
  ) {}

  async list(actor: AuthenticatedUser, productRegistrationId: string): Promise<RegVariation[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.regVariation.findMany({
        where: { companyId, productRegistrationId },
        orderBy: { createdAt: 'desc' },
      }),
    )
  }

  /** testing-correction-explanation.md §2.2 — the company-wide "All Variations" list, independent of any one registration. */
  async listAllForCompany(actor: AuthenticatedUser): Promise<
    (RegVariation & { productRegistration: { registrationNumber: string }; regDossier: { product: { brandName: string }; status: string } })[]
  > {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.regVariation.findMany({
        where: { companyId },
        include: {
          productRegistration: { select: { registrationNumber: true } },
          regDossier: { select: { product: { select: { brandName: true } }, status: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    )
  }

  async get(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<RegVariation & { regDossier: RegDossierWithSlots }> {
    const companyId = requireCompany(actor)
    const found = await this.rls.runAsCompany(companyId, (tx) =>
      tx.regVariation.findFirst({
        where: { id, companyId },
        include: {
          regDossier: {
            include: {
              documentSlots: true,
              product: { select: { brandName: true } },
              authority: { select: { name: true, code: true } },
            },
          },
        },
      }),
    )
    if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Variation not found' })
    return found
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateRegVariationDto,
    meta: RequestMeta,
  ): Promise<RegVariation & { regDossier: RegDossierWithSlots }> {
    const companyId = requireCompany(actor)
    const isRenewal = dto.variationType === RegVariationType.renewal

    const registration = await this.rls.runAsCompany(companyId, (tx) =>
      tx.productRegistration.findFirst({ where: { id: dto.productRegistrationId, companyId } }),
    )
    if (!registration)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Registration not found' })

    // testing-correction-explanation.md §3.5 — an expired or withdrawn
    // registration cannot be renewed; per the user's own literal
    // instruction this check applies to renewal specifically (and to
    // withdrawal/retention, enforced in their own services), not to
    // every variation type.
    if (isRenewal) {
      if (registration.status === 'withdrawn') {
        throw new ConflictException({
          code: 'REGISTRATION_WITHDRAWN',
          message: 'This registration has been withdrawn and cannot be renewed.',
        })
      }
      if (registration.expiresOn < new Date()) {
        throw new ConflictException({
          code: 'REGISTRATION_EXPIRED',
          message:
            'This registration has already expired — renewal is no longer available. Start a fresh re-registration instead.',
        })
      }
    }

    const dossier = await this.regDossierService.create(
      actor,
      {
        productId: dto.productId ?? registration.productId,
        authorityId: dto.authorityId ?? registration.authorityId,
        productClass: dto.productClass ?? registration.productClass ?? '*',
        route: dto.route,
      },
      meta,
      registration.id,
    )

    const created = await this.rls.runAsCompany(companyId, async (tx) => {
      const displayCode = await this.nextDisplayCode(tx, companyId, isRenewal, registration.registrationNumber)

      const variation = await tx.regVariation.create({
        data: {
          id: newId(),
          companyId,
          productRegistrationId: registration.id,
          variationType: dto.variationType,
          displayCode,
          regDossierId: dossier.id,
          status: 'open',
          createdBy: actor.sub,
        },
      })

      // testing-correction-explanation.md §2.2/§3.1 — fast-forward past
      // `planning` straight to this dossier kind's own real entry point.
      const targetStateKey = isRenewal ? 'renewal_requested' : 'variation_application'
      const instance = await tx.workflowInstance.findFirstOrThrow({
        where: { recordType: REG_REGISTRATION_RECORD_TYPE, recordId: dossier.id },
      })
      const targetState = await tx.workflowState.findFirstOrThrow({
        where: { definitionId: instance.definitionId, stateKey: targetStateKey },
      })
      await tx.workflowInstance.update({
        where: { id: instance.id },
        data: { currentStateId: targetState.id },
      })
      await tx.regDossier.update({ where: { id: dossier.id }, data: { status: targetStateKey } })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'reg_variation_created',
        recordType: REG_REGISTRATION_RECORD_TYPE,
        recordId: dossier.id,
        newValue: {
          variationId: variation.id,
          displayCode,
          productRegistrationId: registration.id,
          variationType: dto.variationType,
          fastForwardedTo: targetStateKey,
        },
        ip: meta.ip,
      })

      return variation
    })

    // The dossier object returned from `RegDossierService.create()` above
    // still reads `status: 'planning'` (its value at the moment of that
    // call) — reflect the real, just-applied fast-forward so an immediate
    // caller sees accurate state without a second round-trip.
    const targetStateKey = isRenewal ? 'renewal_requested' : 'variation_application'
    return { ...created, regDossier: { ...dossier, status: targetStateKey } }
  }

  /**
   * testing-correction-explanation.md §2.2 — the two named documents
   * required (alongside ≥1 "accompanying change" document, checked by
   * `RegWorkflowGuards` directly against the generic `Document` table,
   * never a fixed field) before a non-renewal variation can leave
   * `variation_application`. Uploads directly against
   * `(recordType: 'reg_variation', recordId: variation.id)` — the
   * variation row already exists by the time this is called, so no
   * holding-pair trick is needed.
   */
  async attachPaymentProof(
    actor: AuthenticatedUser,
    variationId: string,
    file: DirectUploadFile,
    meta: RequestMeta,
  ): Promise<RegVariation> {
    return this.attachNamedDocument(actor, variationId, file, meta, 'paymentProofDocumentId', 'Proof of Payment', 'reg_variation_payment_proof_attached')
  }

  async attachInvoice(
    actor: AuthenticatedUser,
    variationId: string,
    file: DirectUploadFile,
    meta: RequestMeta,
  ): Promise<RegVariation> {
    return this.attachNamedDocument(actor, variationId, file, meta, 'invoiceDocumentId', 'PPB Variation Invoice', 'reg_variation_invoice_attached')
  }

  private async attachNamedDocument(
    actor: AuthenticatedUser,
    variationId: string,
    file: DirectUploadFile,
    meta: RequestMeta,
    field: 'paymentProofDocumentId' | 'invoiceDocumentId',
    title: string,
    auditAction: string,
  ): Promise<RegVariation> {
    const companyId = requireCompany(actor)
    const variation = await this.rls.runAsCompany(companyId, (tx) =>
      tx.regVariation.findFirst({ where: { id: variationId, companyId } }),
    )
    if (!variation)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Variation not found' })

    const upload = await this.documentsService.uploadDirect(
      actor,
      REG_VARIATION_RECORD_TYPE,
      variationId,
      file,
      { title },
      meta,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const updated = await tx.regVariation.update({
        where: { id: variationId },
        data: { [field]: upload.document.id },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: auditAction,
        recordType: REG_REGISTRATION_RECORD_TYPE,
        recordId: variation.regDossierId,
        newValue: { variationId, documentId: upload.document.id },
        ip: meta.ip,
      })
      return updated
    })
  }

  /**
   * `VAR-00001-<registration number>` for anything except `renewal`,
   * `REN-00001-<registration number>` for a renewal — two independent
   * per-company sequences (never shared), matching this same numbering
   * scheme the Phase 2/3 data migration used to backfill every real
   * pre-existing row.
   */
  private async nextDisplayCode(
    tx: Prisma.TransactionClient,
    companyId: string,
    isRenewal: boolean,
    registrationNumber: string,
  ): Promise<string> {
    const count = await tx.regVariation.count({
      where: {
        companyId,
        variationType: isRenewal ? RegVariationType.renewal : { not: RegVariationType.renewal },
      },
    })
    const seq = String(count + 1).padStart(5, '0')
    return `${isRenewal ? 'REN' : 'VAR'}-${seq}-${registrationNumber}`
  }
}
