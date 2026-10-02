import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { RecallDiscrepancy, RecallReconciliationSnapshot } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { ApproveRecallDiscrepancyExceptionDto } from './dto/approve-recall-discrepancy-exception.dto'
import { CreateRecallDiscrepancyDto } from './dto/create-recall-discrepancy.dto'
import { computeRecallReconciliation } from './recall-reconciliation.util'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Recall reconciliation is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 10.5 — mass-balance reconciliation, always
 * computed live from real rows (`computeRecallReconciliation()`, unit-
 * tested against the Engineering Build Package's own real acceptance
 * fixture), archived as a new `RecallReconciliationSnapshot` row per
 * calculation, never overwritten in place (matching
 * `ManagementReview.metricsSnapshot`'s own precedent).
 *
 * **Honest, documented simplification**: `RecallDistributionRecord`/
 * `RecallQuarantineRecord` are recall-wide, not columns split by
 * destination country (no such column exists on either table — the
 * Engineering Build Package's own country-split acceptance numbers
 * assume a per-country distribution feed this pass didn't design a
 * dedicated field for). `distributed`/`quarantined` are attributed to
 * a specific `RecallCountry` by matching `Stakeholder.country` against
 * that country's own name — a real, reasonable join given the schema
 * as built, but not a guaranteed 1:1 split if a stakeholder's own
 * `country` field is left blank. `dispensed`/`other` have no
 * structural data source in this pass at all and are always `0` —
 * genuinely open for whoever wires up point-of-dispensing evidence
 * later, not silently fabricated here.
 */
@Injectable()
export class RecallReconciliationService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async calculate(
    actor: AuthenticatedUser,
    recallCountryId: string,
    meta: RequestMeta,
  ): Promise<RecallReconciliationSnapshot> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const country = await tx.recallCountry.findFirst({ where: { id: recallCountryId, companyId } })
      if (!country) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall country not found' })
      }
      const countryRow = await tx.country.findUniqueOrThrow({ where: { id: country.countryId } })

      const frozenScope = await tx.recallScopeVersion.findFirst({
        where: { recallId: country.recallId, status: 'frozen' },
        include: { items: true },
        orderBy: { version: 'desc' },
      })
      const batchSize = (frozenScope?.items ?? []).reduce((sum, item) => sum + (item.batchSize ?? 0), 0)

      const [distributedAgg, recoveredAgg, quarantineRows, destroyedAgg] = await Promise.all([
        tx.recallDistributionRecord.aggregate({
          where: { companyId, recallId: country.recallId, toOrg: { country: countryRow.name } },
          _sum: { qtyUnits: true },
        }),
        tx.recallReturnRecord.aggregate({
          where: { companyId, recallId: country.recallId, verdict: 'genuine' },
          _sum: { qty: true },
        }),
        tx.recallQuarantineRecord.findMany({
          where: {
            companyId,
            recallId: country.recallId,
            OR: [{ stakeholderId: null }, { stakeholder: { country: countryRow.name } }],
          },
        }),
        tx.recallDestructionRecord.aggregate({
          where: { companyId, recallCountryId },
          _sum: { units: true },
        }),
      ])

      const quarantined = quarantineRows.reduce((sum, row) => {
        const partUnits = Array.isArray(row.partPacks)
          ? (row.partPacks as { unitsRemaining?: number }[]).reduce(
              (s, p) => s + (p.unitsRemaining ?? 0),
              0,
            )
          : 0
        return sum + row.fullPacks + partUnits
      }, 0)

      const result = computeRecallReconciliation({
        distributed: distributedAgg._sum.qtyUnits ?? 0,
        recovered: recoveredAgg._sum.qty ?? 0,
        quarantined,
        dispensed: 0,
        other: 0,
        destroyed: destroyedAgg._sum.units ?? 0,
        batchSize,
      })

      const snapshot = await tx.recallReconciliationSnapshot.create({
        data: {
          id: newId(),
          companyId,
          recallCountryId,
          distributed: result.distributed,
          recovered: result.recovered,
          quarantined: result.quarantined,
          dispensed: result.dispensed,
          other: result.other,
          accounted: result.accounted,
          outstanding: result.outstanding,
          destroyed: result.destroyed,
          heldByMah: result.heldByMah,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_reconciliation_calculated',
        recordType: 'recall_reconciliation_snapshot',
        recordId: snapshot.id,
        newValue: { accounted: result.accounted, outstanding: result.outstanding },
        ip: meta.ip,
      })

      return snapshot
    })
  }

  async listSnapshots(
    actor: AuthenticatedUser,
    recallCountryId: string,
  ): Promise<RecallReconciliationSnapshot[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.recallReconciliationSnapshot.findMany({
        where: { companyId, recallCountryId },
        orderBy: { calculatedAt: 'desc' },
      }),
    )
  }

  async listDiscrepancies(actor: AuthenticatedUser, recallId: string): Promise<RecallDiscrepancy[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.recallDiscrepancy.findMany({ where: { companyId, recallId }, orderBy: { createdAt: 'desc' } }),
    )
  }

  async createDiscrepancy(
    actor: AuthenticatedUser,
    recallId: string,
    dto: CreateRecallDiscrepancyDto,
    meta: RequestMeta,
  ): Promise<RecallDiscrepancy> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const recall = await tx.recall.findFirst({ where: { id: recallId, companyId } })
      if (!recall) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall not found' })

      const created = await tx.recallDiscrepancy.create({
        data: {
          id: newId(),
          companyId,
          recallId,
          recallCountryId: dto.recallCountryId ?? null,
          units: dto.units,
          reason: dto.reason,
          ownerUserId: dto.ownerUserId ?? null,
          blocking: dto.blocking ?? true,
          createdBy: actor.sub,
        },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_discrepancy_created',
        recordType: 'recall_discrepancy',
        recordId: created.id,
        newValue: { units: dto.units, blocking: created.blocking },
        ip: meta.ip,
      })
      return created
    })
  }

  /** A blocking discrepancy is a real, named closure blocker until an exception is approved here — never a soft warning. */
  async approveException(
    actor: AuthenticatedUser,
    discrepancyId: string,
    dto: ApproveRecallDiscrepancyExceptionDto,
    meta: RequestMeta,
  ): Promise<RecallDiscrepancy> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.recallDiscrepancy.findFirst({ where: { id: discrepancyId, companyId } })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Discrepancy not found' })
      if (existing.status === 'resolved') {
        throw new ConflictException({ code: 'ALREADY_RESOLVED', message: 'This discrepancy is already resolved' })
      }

      const updated = await tx.recallDiscrepancy.update({
        where: { id: discrepancyId },
        data: {
          status: 'resolved',
          exceptionApprovalNote: dto.note,
          exceptionApprovedBy: actor.sub,
          exceptionApprovedAt: new Date(),
        },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_discrepancy_exception_approved',
        recordType: 'recall_discrepancy',
        recordId: discrepancyId,
        newValue: { note: dto.note },
        ip: meta.ip,
      })
      return updated
    })
  }
}
