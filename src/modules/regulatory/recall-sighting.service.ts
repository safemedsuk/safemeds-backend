import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { RecallSighting } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CreateRecallSightingDto } from './dto/create-recall-sighting.dto'
import { ReviewRecallSightingDto } from './dto/review-recall-sighting.dto'
import { RecallCountryService } from './recall-country.service'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A recall sighting is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 10.3 — the real, named "Remedica case"
 * scenario: a batch found in a market where the product isn't
 * registered at all. Reviewing a sighting with `decision:
 * 'notify_regulator'` adds a real new `RecallCountry` and runs 10.1's
 * rules engine for it via the already-built `RecallCountryService`,
 * exactly like any other country — never a bespoke second path.
 */
@Injectable()
export class RecallSightingService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly recallCountryService: RecallCountryService,
  ) {}

  async list(actor: AuthenticatedUser, recallId: string): Promise<RecallSighting[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.recallSighting.findMany({ where: { companyId, recallId }, orderBy: { createdAt: 'desc' } }),
    )
  }

  async create(
    actor: AuthenticatedUser,
    recallId: string,
    dto: CreateRecallSightingDto,
    meta: RequestMeta,
  ): Promise<RecallSighting> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const recall = await tx.recall.findFirst({ where: { id: recallId, companyId } })
      if (!recall) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall not found' })

      const created = await tx.recallSighting.create({
        data: {
          id: newId(),
          companyId,
          recallId,
          country: dto.country,
          source: dto.source,
          evidenceDocumentId: dto.evidenceDocumentId ?? null,
          createdBy: actor.sub,
        },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_sighting_created',
        recordType: 'recall_sighting',
        recordId: created.id,
        newValue: { country: created.country, source: created.source },
        ip: meta.ip,
      })
      return created
    })
  }

  async review(
    actor: AuthenticatedUser,
    sightingId: string,
    dto: ReviewRecallSightingDto,
    meta: RequestMeta,
  ): Promise<RecallSighting> {
    const companyId = requireCompany(actor)
    const updated = await this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.recallSighting.findFirst({ where: { id: sightingId, companyId } })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Sighting not found' })

      const result = await tx.recallSighting.update({
        where: { id: sightingId },
        data: {
          reviewed: true,
          decision: dto.decision,
          reviewedBy: actor.sub,
          reviewedAt: new Date(),
        },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_sighting_reviewed',
        recordType: 'recall_sighting',
        recordId: sightingId,
        newValue: { decision: dto.decision },
        ip: meta.ip,
      })
      return result
    })

    if (dto.decision === 'notify_regulator' && dto.countryId) {
      await this.recallCountryService.addCountry(
        actor,
        updated.recallId,
        { countryId: dto.countryId, regulatoryAuthorityId: dto.regulatoryAuthorityId },
        meta,
      )
    }

    return updated
  }
}
