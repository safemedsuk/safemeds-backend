import { Injectable, OnModuleInit } from '@nestjs/common'

import { newId } from '../../common/id'
import {
  TransitionGuardFn,
  WorkflowGuardRegistryService,
} from '../workflow/workflow-guard-registry.service'
import { WorkflowStatusSyncRegistryService } from '../workflow/workflow-status-sync-registry.service'
import { CompletenessGateService } from './completeness-gate.service'
import { RegConfigService } from './reg-config.service'
import { RegDeadlineService } from './reg-deadline.service'
import { addInterval } from './reg-deadline-date.util'
import { REG_REGISTRATION_RECORD_TYPE } from './reg-dossier.service'
import { RegPostMarketObligationService } from './reg-post-market-obligation.service'

/**
 * RegCloud (Phase 12) Stages 3–7 — every `reg_registration` workflow
 * guard *and* the record type's whole status-sync/approval behavior
 * lives here, registered against the **already-existing, proven**
 * `WorkflowGuardRegistryService`/`WorkflowStatusSyncRegistryService`
 * (VigiCloud Stage 3.7/SC-1's own extension points) rather than any new
 * gating mechanism — the literal reuse `todo-regcloud.md`'s own Stage 3
 * bullet calls for, extended across every later stage that needed a
 * transition gated or a real domain action performed on one.
 *
 * The single status-sync function below is intentionally one growing
 * function, not several — it's the one place `reg_registration`'s
 * *entire* lifecycle behavior is wired, branching on `toStateKey`:
 * - every transition: keep `RegDossier.status` in sync (Stage 3, day one).
 * - `→ approved`: create a new `ProductRegistration` (Stage 6) *or*
 *   update an existing one (Stage 7's variation/renewal), depending on
 *   whether a `RegVariation` row already wraps this dossier — never on
 *   the mere presence of `RegDossier.productRegistrationId` alone,
 *   which is not itself proof of anything (see the guard below for why).
 * - `→ rejected`: mark a wrapping `RegVariation` rejected, if one exists.
 */
@Injectable()
export class RegWorkflowGuards implements OnModuleInit {
  constructor(
    private readonly guardRegistry: WorkflowGuardRegistryService,
    private readonly statusSyncRegistry: WorkflowStatusSyncRegistryService,
    private readonly completenessGateService: CompletenessGateService,
    private readonly regConfigService: RegConfigService,
    private readonly regDeadlineService: RegDeadlineService,
    private readonly regPostMarketObligationService: RegPostMarketObligationService,
  ) {}

  onModuleInit(): void {
    this.statusSyncRegistry.register(
      REG_REGISTRATION_RECORD_TYPE,
      async ({ tx, recordId, companyId, actorUserId, toStateKey, payload }) => {
        await tx.regDossier.update({ where: { id: recordId }, data: { status: toStateKey } })

        if (toStateKey === 'approved') {
          const dossier = await tx.regDossier.findUniqueOrThrow({
            where: { id: recordId },
            include: { authority: true },
          })
          // Never trust `RegDossier.productRegistrationId` alone to decide
          // "this is a variation" — it's settable via the public dossier-
          // create endpoint in principle (harmlessly inert on its own; see
          // `CreateRegDossierDto`'s own doc comment). The one thing that
          // can only ever exist via `RegVariationService.create()`'s own
          // atomic pairing is a real `RegVariation` row pointing back at
          // this exact dossier — that's the real signal.
          const variation = await tx.regVariation.findFirst({ where: { regDossierId: recordId } })

          if (variation) {
            // Stage 7 — update the existing registration rather than creating a new one.
            const registration = await tx.productRegistration.findUniqueOrThrow({
              where: { id: variation.productRegistrationId },
            })
            const updates: {
              expiresOn?: Date
              manufacturingSiteId?: string
              localRepresentativeId?: string
            } = {}

            if (variation.variationType === 'renewal') {
              const rule = await this.regConfigService.resolveDeadlineRule(
                dossier.authority.countryId,
                dossier.authorityId,
                dossier.productClass,
                'renewal',
              )
              const explicitExpiresOn =
                typeof payload?.expiresOn === 'string' ? new Date(payload.expiresOn) : null
              updates.expiresOn = rule
                ? addInterval(
                    registration.expiresOn,
                    rule.intervalValue,
                    rule.intervalUnit as 'days' | 'months' | 'years',
                  )
                : explicitExpiresOn!

              // Resets the same renewal `RegDeadline` row for the next
              // cycle, clearing prior escalation state — exactly what
              // should happen the moment a registration is freshly
              // renewed. Nested `rls.runAsCompany` call, same precedent
              // as `PvCaseService.create()` calling `workflowService.instantiate()`
              // from inside its own already-open transaction.
              await this.regDeadlineService.computeOrRecompute({
                companyId,
                recordType: 'reg_registration_renewal',
                recordId: registration.id,
                countryId: dossier.authority.countryId,
                authorityId: dossier.authorityId,
                productClass: dossier.productClass,
                obligationType: 'renewal',
                triggerDate: registration.expiresOn,
                actorUserId,
              })
            }
            if (typeof payload?.manufacturingSiteId === 'string')
              updates.manufacturingSiteId = payload.manufacturingSiteId
            if (typeof payload?.localRepresentativeId === 'string')
              updates.localRepresentativeId = payload.localRepresentativeId

            const updatedRegistration = await tx.productRegistration.update({
              where: { id: registration.id },
              data: updates,
            })
            await tx.regVariation.update({
              where: { id: variation.id },
              data: { status: 'approved', approvedAt: new Date() },
            })
            // Stage 8 — a variation may have changed `productClass`/reactivated
            // the registration; re-check for any newly-applicable obligation
            // type. Create-only, never disturbs an already-tracked cycle.
            await this.regPostMarketObligationService.ensureObligationsForRegistration(
              companyId,
              updatedRegistration,
              actorUserId ?? null,
            )
          } else {
            // Stage 6 — a fresh registration. The guard below already
            // proved `payload.registrationNumber` (and a resolvable
            // expiry) exist before this ever runs.
            const registrationNumber = payload!.registrationNumber as string
            const issuedOn =
              typeof payload?.issuedOn === 'string' ? new Date(payload.issuedOn) : new Date()
            const rule = await this.regConfigService.resolveDeadlineRule(
              dossier.authority.countryId,
              dossier.authorityId,
              dossier.productClass,
              'renewal',
            )
            const explicitExpiresOn =
              typeof payload?.expiresOn === 'string' ? new Date(payload.expiresOn) : null
            const expiresOn = rule
              ? addInterval(
                  issuedOn,
                  rule.intervalValue,
                  rule.intervalUnit as 'days' | 'months' | 'years',
                )
              : explicitExpiresOn!

            const registration = await tx.productRegistration.create({
              data: {
                id: newId(),
                companyId,
                productId: dossier.productId,
                authorityId: dossier.authorityId,
                registrationNumber,
                status: 'active',
                issuedOn,
                expiresOn,
                productClass: dossier.productClass,
                manufacturingSiteId:
                  typeof payload?.manufacturingSiteId === 'string'
                    ? payload.manufacturingSiteId
                    : undefined,
                localRepresentativeId:
                  typeof payload?.localRepresentativeId === 'string'
                    ? payload.localRepresentativeId
                    : undefined,
              },
            })

            await tx.regDossier.update({
              where: { id: recordId },
              data: { productRegistrationId: registration.id },
            })

            await this.regDeadlineService.computeOrRecompute({
              companyId,
              recordType: 'reg_registration_renewal',
              recordId: registration.id,
              countryId: dossier.authority.countryId,
              authorityId: dossier.authorityId,
              productClass: dossier.productClass,
              obligationType: 'renewal',
              triggerDate: issuedOn,
              actorUserId,
            })

            // Stage 8 — start tracking whatever post-market obligation
            // types are already configured for this country/authority/
            // productClass the moment the registration goes live.
            await this.regPostMarketObligationService.ensureObligationsForRegistration(
              companyId,
              registration,
              actorUserId ?? null,
            )
          }
        }

        if (toStateKey === 'rejected') {
          const variation = await tx.regVariation.findFirst({ where: { regDossierId: recordId } })
          if (variation) {
            await tx.regVariation.update({
              where: { id: variation.id },
              data: { status: 'rejected' },
            })
          }
        }
      },
    )

    // Stage 3 — the flagship completeness gate, blocking Compiling → Completeness Check.
    this.guardRegistry.register(
      REG_REGISTRATION_RECORD_TYPE,
      'compiling',
      async ({ tx, recordId }) => {
        const result = await this.completenessGateService.evaluateInTx(tx, recordId)
        if (result.allowed) return { allowed: true }

        const missing = result.slots.filter((s) => !s.met).map((s) => s.label)
        return {
          allowed: false,
          reason: `This dossier is missing required document(s): ${missing.join(', ')}.`,
        }
      },
    )

    // Stage 4 — blocked until a generated `RegSubmission` has real dispatch evidence attached, the same "No Gateway" honesty VigiCloud's own E2B submission established.
    this.guardRegistry.register(
      REG_REGISTRATION_RECORD_TYPE,
      'completeness_check',
      async ({ tx, recordId, toStateKey }) => {
        if (toStateKey !== 'submitted') return { allowed: true }

        const latest = await tx.regSubmission.findFirst({
          where: { regDossierId: recordId },
          orderBy: { submissionNumber: 'desc' },
        })
        if (!latest) {
          return {
            allowed: false,
            reason:
              'No submission package has been generated for this dossier yet — generate one before marking it Submitted.',
          }
        }
        if (!latest.evidenceDocumentId) {
          return {
            allowed: false,
            reason: "This dossier's generated submission has no dispatch evidence attached yet.",
          }
        }
        return { allowed: true }
      },
    )

    // Stage 5 — both entry points into a query round require the query's
    // own content to already be logged (`RegQueryService.receive()`).
    const requireOpenQuery: TransitionGuardFn = async ({ tx, recordId, toStateKey }) => {
      if (toStateKey !== 'query_received') return { allowed: true }
      const openQuery = await tx.regQuery.findFirst({
        where: { regDossierId: recordId, status: 'open' },
      })
      if (!openQuery) {
        return {
          allowed: false,
          reason: "Log the regulator's query first — no open query exists for this dossier yet.",
        }
      }
      return { allowed: true }
    }
    this.guardRegistry.register(REG_REGISTRATION_RECORD_TYPE, 'submitted', requireOpenQuery)
    this.guardRegistry.register(
      REG_REGISTRATION_RECORD_TYPE,
      'resubmitted_for_review',
      requireOpenQuery,
    )

    // Stage 5 — blocked until the latest query actually has a response attached (`RegQueryService.respond()`).
    this.guardRegistry.register(
      REG_REGISTRATION_RECORD_TYPE,
      'responding',
      async ({ tx, recordId, toStateKey }) => {
        if (toStateKey !== 'resubmitted_for_review') return { allowed: true }
        const latest = await tx.regQuery.findFirst({
          where: { regDossierId: recordId },
          orderBy: { createdAt: 'desc' },
        })
        if (!latest || latest.status !== 'closed') {
          return {
            allowed: false,
            reason: 'Respond to the open regulator query before resubmitting for review.',
          }
        }
        return { allowed: true }
      },
    )

    // Stage 6/7 — the two real decision points, both reachable from
    // Submitted (no query round needed) or after a full query cycle.
    // Validates only that enough data exists to act on — the actual
    // creation/update happens in the status-sync function above, after
    // this guard (and the role/signature checks) already passed.
    const requireApprovalData: TransitionGuardFn = async ({
      tx,
      recordId,
      toStateKey,
      payload,
    }) => {
      if (toStateKey !== 'approved') return { allowed: true }

      const dossier = await tx.regDossier.findUniqueOrThrow({
        where: { id: recordId },
        include: { authority: true },
      })
      const variation = await tx.regVariation.findFirst({ where: { regDossierId: recordId } })
      const hasResolvableExpiry = Boolean(
        (await this.regConfigService.resolveDeadlineRule(
          dossier.authority.countryId,
          dossier.authorityId,
          dossier.productClass,
          'renewal',
        )) || typeof payload?.expiresOn === 'string',
      )

      if (!variation) {
        if (
          typeof payload?.registrationNumber !== 'string' ||
          payload.registrationNumber.trim().length === 0
        ) {
          return {
            allowed: false,
            reason: 'A registration number is required to approve this dossier.',
          }
        }
        if (!hasResolvableExpiry) {
          return {
            allowed: false,
            reason:
              'No renewal cadence is configured for this market — an explicit expiry date is required to approve this dossier.',
          }
        }
        return { allowed: true }
      }

      if (variation.variationType === 'renewal' && !hasResolvableExpiry) {
        return {
          allowed: false,
          reason:
            'No renewal cadence is configured for this market — an explicit expiry date is required to approve this renewal.',
        }
      }
      return { allowed: true }
    }
    this.guardRegistry.register(REG_REGISTRATION_RECORD_TYPE, 'submitted', requireApprovalData)
    this.guardRegistry.register(
      REG_REGISTRATION_RECORD_TYPE,
      'resubmitted_for_review',
      requireApprovalData,
    )
  }
}
