import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Facility, Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService, diffForAudit } from '../audit/audit.service'
import { CreateFacilityDto } from './dto/create-facility.dto'
import { ListFacilitiesQueryDto } from './dto/list-facilities-query.dto'
import { UpdateFacilityDto } from './dto/update-facility.dto'
import { UpdateFacilityLicenceDto } from './dto/update-facility-licence.dto'
import { LocationScopeService } from './location-scope.service'

export interface RequestMeta {
  ip?: string
}

export interface FacilityOverviewRow extends Facility {
  /**
   * How many users have location-access specifically scoped to this
   * facility (a direct facility-level grant, or a market-level grant
   * covering the facility's country) — a measure of what
   * `UserLocationScope` actually tracks (access control), not a staff
   * roster. An unrestricted user (no scope rows at all, including every
   * `SYSTEM_ADMINISTRATOR`) is deliberately not counted here for any
   * facility — they see everything without being scoped to anything in
   * particular.
   */
  scopedUserCount: number
}

export interface FacilitiesOverview {
  /** Whether the caller sees every facility (MD/executive altitude) or only the ones they're scoped to (department-head altitude). */
  unrestricted: boolean
  facilities: FacilityOverviewRow[]
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Facilities are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * Locations (Phase-4.1-schema `Facility`) — one or many physical sites a
 * company operates from, each pinned to the country whose rules/forms
 * govern cases reported from it. Never delete, only `isActive: false`,
 * same convention as Product/Batch/ProductRegistration.
 */
@Injectable()
export class FacilitiesService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly locationScopeService: LocationScopeService,
  ) {}

  /**
   * Stage 0.8 "two-altitude" view: an unrestricted caller (MD/executive,
   * or anyone with zero `UserLocationScope` rows — including every
   * `SYSTEM_ADMINISTRATOR`) sees every facility in the company; a
   * scoped caller (department head) sees only the facility/facilities
   * their own grants cover. `scopedUserCount` is deliberately an
   * access-control count (how many users are scoped to see this
   * facility), not a staff headcount — `UserLocationScope` doesn't
   * model employment/roster data, so this endpoint doesn't pretend it
   * does.
   */
  async overview(actor: AuthenticatedUser): Promise<FacilitiesOverview> {
    const companyId = requireCompany(actor)
    const access = await this.locationScopeService.getEffectiveAccess(
      companyId,
      actor.sub,
      actor.roleKeys,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.FacilityWhereInput = {
        companyId,
        ...(access.unrestricted ? {} : { id: { in: access.facilityIds } }),
      }
      const facilities = await tx.facility.findMany({ where, orderBy: { name: 'asc' } })

      const allScopes = await tx.userLocationScope.findMany({ where: { companyId } })
      const scopedUsersByFacility = new Map<string, Set<string>>()
      const addScopedUser = (facilityId: string, userId: string) => {
        if (!scopedUsersByFacility.has(facilityId)) scopedUsersByFacility.set(facilityId, new Set())
        scopedUsersByFacility.get(facilityId)!.add(userId)
      }
      for (const scope of allScopes) {
        if (scope.level === 'facility' && scope.facilityId) {
          addScopedUser(scope.facilityId, scope.userId)
        } else if (scope.level === 'market' && scope.countryId) {
          for (const facility of facilities) {
            if (facility.countryId === scope.countryId) addScopedUser(facility.id, scope.userId)
          }
        }
      }

      return {
        unrestricted: access.unrestricted,
        facilities: facilities.map((f) => ({
          ...f,
          scopedUserCount: scopedUsersByFacility.get(f.id)?.size ?? 0,
        })),
      }
    })
  }

  async list(
    actor: AuthenticatedUser,
    query: ListFacilitiesQueryDto,
  ): Promise<PaginatedResult<Facility>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.FacilityWhereInput = {
        companyId,
        ...(query.countryId ? { countryId: query.countryId } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.facility.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.facility.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateFacilityDto,
    meta: RequestMeta,
  ): Promise<Facility> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const country = await tx.country.findUnique({ where: { id: dto.countryId } })
      if (!country) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unknown country' })

      const created = await tx.facility.create({
        data: {
          id: newId(),
          companyId,
          countryId: dto.countryId,
          name: dto.name,
          facilityCode: dto.facilityCode,
          county: dto.county,
          subCounty: dto.subCounty,
          address: dto.address,
          phone: dto.phone,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'facility_created',
        recordType: 'facility',
        recordId: created.id,
        newValue: { name: created.name, countryId: created.countryId },
        ip: meta.ip,
      })

      return created
    })
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateFacilityDto,
    meta: RequestMeta,
  ): Promise<Facility> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await this.findOrThrow(tx, companyId, id)

      if (dto.countryId) {
        const country = await tx.country.findUnique({ where: { id: dto.countryId } })
        if (!country) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unknown country' })
      }

      const updated = await tx.facility.update({ where: { id }, data: dto })
      const diff = diffForAudit(existing, updated)

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'facility_updated',
        recordType: 'facility',
        recordId: id,
        oldValue: diff.oldValue,
        newValue: diff.newValue,
        ip: meta.ip,
      })

      return updated
    })
  }

  async deactivate(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<Facility> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      await this.findOrThrow(tx, companyId, id)
      const updated = await tx.facility.update({ where: { id }, data: { isActive: false } })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'facility_deactivated',
        recordType: 'facility',
        recordId: id,
        ip: meta.ip,
      })

      return updated
    })
  }

  /**
   * RegCloud (Phase 12) Stage 10 — Establishment/Premises Licensing.
   * Deliberately a separate, narrow endpoint from the generic `update()`
   * above, gated by `regulatory.manage_licensing` rather than
   * `company_profile.manage` — editing a facility's own regulatory
   * licence is a materially different trust boundary than editing its
   * address/phone. `licenceExpiresOn` is never auto-computed from a
   * `RegDeadlineRule` here (unlike `ProductRegistration.expiresOn`) — a
   * facility's premises licence has no single natural `RegulatoryAuthority`
   * the way a product registration does (see the DTO's own doc comment)
   * — always the tenant's own directly-entered value.
   */
  async updateLicence(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateFacilityLicenceDto,
    meta: RequestMeta,
  ): Promise<Facility> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await this.findOrThrow(tx, companyId, id)

      const updated = await tx.facility.update({
        where: { id },
        data: {
          ...(dto.licenceNumber !== undefined ? { licenceNumber: dto.licenceNumber } : {}),
          ...(dto.licenceIssuedOn !== undefined
            ? { licenceIssuedOn: new Date(dto.licenceIssuedOn) }
            : {}),
          // A changed expiry date opens a fresh renewal cycle — clear the
          // prior cycle's "already reminded" guard so the 90-day
          // approaching window can fire again for this new date, exactly
          // like `RegDeadlineService.computeOrRecompute()`'s own
          // "a recompute clears prior escalation state" precedent.
          ...(dto.licenceExpiresOn !== undefined
            ? { licenceExpiresOn: new Date(dto.licenceExpiresOn), licenceRenewalNotifiedAt: null }
            : {}),
          ...(dto.licenceStatus !== undefined ? { licenceStatus: dto.licenceStatus } : {}),
          ...(dto.licenceDocumentId !== undefined
            ? { licenceDocumentId: dto.licenceDocumentId }
            : {}),
        },
      })
      const diff = diffForAudit(existing, updated)

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'facility_licence_updated',
        recordType: 'facility',
        recordId: id,
        oldValue: diff.oldValue,
        newValue: diff.newValue,
        ip: meta.ip,
      })

      return updated
    })
  }

  private async findOrThrow(
    tx: Prisma.TransactionClient,
    companyId: string,
    id: string,
  ): Promise<Facility> {
    const facility = await tx.facility.findFirst({ where: { id, companyId } })
    if (!facility) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Facility not found' })
    return facility
  }
}
