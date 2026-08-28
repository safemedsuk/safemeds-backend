import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { UserLocationScope } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { GrantLocationScopeDto } from './dto/grant-location-scope.dto'

export interface RequestMeta {
  ip?: string
}

export interface EffectiveAccess {
  /** `true` for `SYSTEM_ADMINISTRATOR` or any user with zero scope rows — the "Admins always see everything" / "unrestricted by default" decision. */
  unrestricted: boolean
  facilityIds: string[]
  /**
   * RegCloud (Phase 12) Stage 0.6 — every country this user's scope grants
   * reach: a market-level grant's own `countryId` directly, plus (for a
   * facility-level grant) that facility's own country. Added alongside
   * `facilityIds` rather than replacing it — `Facility` (this mechanism's
   * original Stage 0.8 consumer) still needs the facility-level view, while
   * a record with a country dimension but no facility of its own (a
   * `ProductRegistration`/`RegDossier`, reached only via
   * `authorityId → countryId`) needs this one instead.
   */
  countryIds: string[]
}

export interface LocationScopeDto extends UserLocationScope {
  countryName: string | null
  facilityName: string | null
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Location scoping is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * VigiCloud Stage 0.8 — "permissions follow org structure." A user with
 * no scope rows at all is unrestricted (sees the whole company); adding
 * one or more rows narrows them to exactly that set of markets/
 * facilities. `SYSTEM_ADMINISTRATOR` bypasses this entirely, checked by
 * role key here rather than in the schema — a role check isn't a schema
 * concern. This was explicitly deferred in an earlier planning pass
 * ("Wait until Phase 11") — this is that phase.
 */
@Injectable()
export class LocationScopeService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async grant(
    actor: AuthenticatedUser,
    targetUserId: string,
    dto: GrantLocationScopeDto,
    meta: RequestMeta,
  ): Promise<LocationScopeDto> {
    const companyId = requireCompany(actor)
    this.assertLevelShape(dto)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const targetUser = await tx.user.findFirst({ where: { id: targetUserId, companyId } })
      if (!targetUser) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'User not found in this company',
        })
      }

      let countryName: string | null = null
      let facilityName: string | null = null
      if (dto.level === 'market') {
        const country = await tx.country.findUnique({ where: { id: dto.countryId } })
        if (!country) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unknown country' })
        countryName = country.name
      } else {
        const facility = await tx.facility.findFirst({ where: { id: dto.facilityId, companyId } })
        if (!facility)
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: 'Facility not found in this company',
          })
        facilityName = facility.name
      }

      const existing = await tx.userLocationScope.findFirst({
        where: {
          companyId,
          userId: targetUserId,
          level: dto.level,
          countryId: dto.level === 'market' ? dto.countryId : null,
          facilityId: dto.level === 'facility' ? dto.facilityId : null,
        },
      })
      if (existing) {
        throw new ConflictException({
          code: 'ALREADY_GRANTED',
          message: 'This user already has that exact location scope',
        })
      }

      const created = await tx.userLocationScope.create({
        data: {
          id: newId(),
          companyId,
          userId: targetUserId,
          level: dto.level,
          countryId: dto.level === 'market' ? dto.countryId : null,
          facilityId: dto.level === 'facility' ? dto.facilityId : null,
          grantedBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'location_scope_granted',
        recordType: 'user_location_scope',
        recordId: created.id,
        newValue: {
          userId: targetUserId,
          level: dto.level,
          countryId: created.countryId,
          facilityId: created.facilityId,
        },
        ip: meta.ip,
      })

      return { ...created, countryName, facilityName }
    })
  }

  async revoke(actor: AuthenticatedUser, scopeId: string, meta: RequestMeta): Promise<void> {
    const companyId = requireCompany(actor)

    await this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.userLocationScope.findFirst({ where: { id: scopeId, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Location scope not found' })
      }

      await tx.userLocationScope.delete({ where: { id: scopeId } })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'location_scope_revoked',
        recordType: 'user_location_scope',
        recordId: scopeId,
        oldValue: {
          userId: existing.userId,
          level: existing.level,
          countryId: existing.countryId,
          facilityId: existing.facilityId,
        },
        ip: meta.ip,
      })
    })
  }

  async listForUser(actor: AuthenticatedUser, targetUserId: string): Promise<LocationScopeDto[]> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const scopes = await tx.userLocationScope.findMany({
        where: { companyId, userId: targetUserId },
        orderBy: { createdAt: 'desc' },
        include: { country: { select: { name: true } }, facility: { select: { name: true } } },
      })

      return scopes.map((scope) => ({
        ...scope,
        countryName: scope.country?.name ?? null,
        facilityName: scope.facility?.name ?? null,
      }))
    })
  }

  /** The caller's own effective access — no permission gate beyond being authenticated, since a user is always allowed to know their own access shape. */
  async getMyEffectiveAccess(actor: AuthenticatedUser): Promise<EffectiveAccess> {
    const companyId = requireCompany(actor)
    return this.getEffectiveAccess(companyId, actor.sub, actor.roleKeys)
  }

  /**
   * Resolves a user's effective facility access — `unrestricted: true`
   * for `SYSTEM_ADMINISTRATOR` or a user with zero scope rows (both
   * "see everything"); otherwise a concrete list of facility ids, with a
   * market-level grant expanded to every facility currently in that
   * country (so adding a facility to an already-market-scoped country
   * doesn't require re-granting anyone).
   */
  async getEffectiveAccess(
    companyId: string,
    userId: string,
    roleKeys: string[],
  ): Promise<EffectiveAccess> {
    if (roleKeys.includes('SYSTEM_ADMINISTRATOR')) {
      return { unrestricted: true, facilityIds: [], countryIds: [] }
    }

    return this.rls.runAsCompany(companyId, async (tx) => {
      const scopes = await tx.userLocationScope.findMany({ where: { companyId, userId } })
      if (scopes.length === 0) {
        return { unrestricted: true, facilityIds: [], countryIds: [] }
      }

      const explicitFacilityIds = scopes
        .filter((s) => s.level === 'facility')
        .map((s) => s.facilityId!)
      const marketCountryIds = scopes.filter((s) => s.level === 'market').map((s) => s.countryId!)

      let facilityIdsFromMarkets: string[] = []
      if (marketCountryIds.length > 0) {
        const facilities = await tx.facility.findMany({
          where: { companyId, countryId: { in: marketCountryIds } },
          select: { id: true },
        })
        facilityIdsFromMarkets = facilities.map((f) => f.id)
      }

      let countryIdsFromFacilities: string[] = []
      if (explicitFacilityIds.length > 0) {
        const explicitFacilities = await tx.facility.findMany({
          where: { companyId, id: { in: explicitFacilityIds } },
          select: { countryId: true },
        })
        countryIdsFromFacilities = explicitFacilities.map((f) => f.countryId)
      }

      return {
        unrestricted: false,
        facilityIds: Array.from(new Set([...explicitFacilityIds, ...facilityIdsFromMarkets])),
        countryIds: Array.from(new Set([...marketCountryIds, ...countryIdsFromFacilities])),
      }
    })
  }

  private assertLevelShape(dto: GrantLocationScopeDto): void {
    if (dto.level === 'market' && (!dto.countryId || dto.facilityId)) {
      throw new BadRequestException({
        code: 'INVALID_SCOPE',
        message: 'A "market" scope requires countryId and no facilityId',
      })
    }
    if (dto.level === 'facility' && (!dto.facilityId || dto.countryId)) {
      throw new BadRequestException({
        code: 'INVALID_SCOPE',
        message: 'A "facility" scope requires facilityId and no countryId',
      })
    }
  }
}
