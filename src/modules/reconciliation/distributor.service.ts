import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Distributor } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { RolesService } from '../roles/roles.service'
import { CreateDistributorDto } from './dto/create-distributor.dto'
import { ListDistributorsQueryDto } from './dto/list-distributors-query.dto'
import { ListPlatformDistributorsQueryDto } from './dto/list-platform-distributors-query.dto'
import { UpdateDistributorDto } from './dto/update-distributor.dto'

export interface RequestMeta {
  ip?: string
}

export const DISTRIBUTOR_RECORD_TYPE = 'distributor'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Distributors are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

export interface PlatformDistributorSummary {
  id: string
  name: string
  ownerCompanyId: string
  ownerCompanyName: string
  distributorCompanyId: string | null
  distributorCompanyName: string | null
}

export interface TenantMatchSuggestion {
  companyId: string
  companyName: string
}

/**
 * VigiCloud Stage 15.1 — a manufacturer tenant's own list of its
 * distributors. Standard RLS-scoped tenant CRUD, modeled on
 * `ClinicalTrialService`; the one deliberate omission is a create/update
 * path for `distributorCompanyId` (the cross-tenant link) — see
 * `CreateDistributorDto`'s own doc comment for why that's platform-only.
 */
@Injectable()
export class DistributorService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly rolesService: RolesService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    dto: CreateDistributorDto,
    meta: RequestMeta,
  ): Promise<Distributor> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.distributor.findUnique({
        where: { companyId_name: { companyId, name: dto.name } },
      })
      if (existing) {
        throw new ConflictException({
          code: 'DUPLICATE_DISTRIBUTOR_NAME',
          message: 'A distributor with this name already exists',
        })
      }

      const created = await tx.distributor.create({
        data: {
          id: newId(),
          companyId,
          name: dto.name,
          contactEmail: dto.contactEmail ?? null,
          contactPhone: dto.contactPhone ?? null,
          countryId: dto.countryId ?? null,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'distributor_created',
        recordType: DISTRIBUTOR_RECORD_TYPE,
        recordId: created.id,
        newValue: { name: created.name },
        ip: meta.ip,
      })

      return created
    })
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateDistributorDto,
    meta: RequestMeta,
  ): Promise<Distributor> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.distributor.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Distributor not found' })
      }

      const updated = await tx.distributor.update({ where: { id }, data: dto })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'distributor_updated',
        recordType: DISTRIBUTOR_RECORD_TYPE,
        recordId: id,
        oldValue: { name: existing.name, status: existing.status },
        newValue: dto as Record<string, unknown>,
        ip: meta.ip,
      })

      return updated
    })
  }

  async list(
    actor: AuthenticatedUser,
    query: ListDistributorsQueryDto,
  ): Promise<PaginatedResult<Distributor>> {
    const companyId = requireCompany(actor)
    await this.requireReadAccess(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = {
        companyId,
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.distributor.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.distributor.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Distributor> {
    const companyId = requireCompany(actor)
    await this.requireReadAccess(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.distributor.findFirst({ where: { id, companyId } })
      if (!found) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Distributor not found' })
      }
      return found
    })
  }

  /**
   * VigiCloud Stage 15.1 — platform-only: verifies a real, active
   * SafeMeds tenant before linking it as this distributor's own tenant
   * company, the precondition `ReconciliationService.crossTenantSummary()`
   * checks before ever reading into another tenant's data. `targetCompanyId:
   * null` unlinks. Reuses `RlsService.runWithPlatformAccess()` exactly as
   * `EntitlementsService.grant()` already does — a mandatory,
   * structurally-unskippable `platform_access` audit entry in the same
   * transaction as the write.
   */
  async linkTenant(
    platformActorUserId: string,
    distributorId: string,
    targetCompanyId: string | null,
    meta: RequestMeta,
  ): Promise<Distributor> {
    return this.rls.runWithPlatformAccess(
      platformActorUserId,
      `Link distributor ${distributorId} to tenant ${targetCompanyId ?? '(none)'}`,
      async (tx) => {
        const distributor = await tx.distributor.findUnique({ where: { id: distributorId } })
        if (!distributor) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Distributor not found' })
        }

        if (targetCompanyId) {
          const targetCompany = await tx.company.findUnique({ where: { id: targetCompanyId } })
          if (!targetCompany || targetCompany.status !== 'active') {
            throw new NotFoundException({
              code: 'NOT_FOUND',
              message: 'Target company not found or not an active tenant',
            })
          }
          if (targetCompanyId === distributor.companyId) {
            throw new ConflictException({
              code: 'INVALID_LINK',
              message: 'A company cannot be linked as its own distributor',
            })
          }
        }

        const updated = await tx.distributor.update({
          where: { id: distributorId },
          data: { distributorCompanyId: targetCompanyId },
        })

        await this.auditService.log(tx, {
          companyId: distributor.companyId,
          actorUserId: platformActorUserId,
          action: 'distributor_tenant_linked',
          recordType: DISTRIBUTOR_RECORD_TYPE,
          recordId: distributorId,
          oldValue: { distributorCompanyId: distributor.distributorCompanyId },
          newValue: { distributorCompanyId: targetCompanyId },
          ip: meta.ip,
        })

        return updated
      },
    )
  }

  /**
   * testing-todo 15.1 — real-usage feedback: "let's build this maybe even
   * automatically such that it can be done by the platform admins," scoped
   * to the case both sides are real SafeMeds tenants (a distributor that
   * will never be a tenant keeps using the existing manual flow
   * unchanged). Platform-wide, across every manufacturer tenant's own
   * distributor list — the tenant-scoped `list()` above can't see this,
   * by design (RLS). `distributorCompanyId: null` is a genuinely meaningful
   * state (Stage 15's own "confirmed not distributor-sourced" precedent)
   * so `unlinkedOnly` filters on it explicitly rather than treating every
   * row the same.
   */
  async listAllForPlatform(
    query: ListPlatformDistributorsQueryDto,
  ): Promise<PaginatedResult<PlatformDistributorSummary>> {
    return this.rls.runWithSystemAccess(async (tx) => {
      const where = {
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
        ...(query.unlinkedOnly ? { distributorCompanyId: null } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.distributor.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          select: {
            id: true,
            name: true,
            companyId: true,
            company: { select: { name: true } },
            distributorCompanyId: true,
            distributorCompany: { select: { name: true } },
          },
        }),
        tx.distributor.count({ where }),
      ])

      const summaries: PlatformDistributorSummary[] = rows.map((row) => ({
        id: row.id,
        name: row.name,
        ownerCompanyId: row.companyId,
        ownerCompanyName: row.company.name,
        distributorCompanyId: row.distributorCompanyId,
        distributorCompanyName: row.distributorCompany?.name ?? null,
      }))

      return paginate(summaries, total, query)
    })
  }

  /**
   * testing-todo 15.1 — auto-match candidates for the "both sides are real
   * tenants" case: any active company (other than the distributor's own
   * owning company — a company can't be its own distributor, matching
   * `linkTenant()`'s own guard) whose name overlaps the distributor's,
   * case-insensitively and trimmed in either direction — the exact same
   * matching discipline `ReconciliationService`'s own case-to-distributor
   * auto-match already established (see that service's `normalize()`),
   * just applied the other direction (distributor name → tenant company
   * name) since there's no third source of truth to compare both against.
   * A human still confirms the link — this only ever suggests.
   */
  async suggestTenantMatches(distributorId: string): Promise<TenantMatchSuggestion[]> {
    return this.rls.runWithSystemAccess(async (tx) => {
      const distributor = await tx.distributor.findUnique({ where: { id: distributorId } })
      if (!distributor) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Distributor not found' })
      }

      const target = normalizeName(distributor.name)
      const candidates = await tx.company.findMany({
        where: { status: 'active' },
        select: { id: true, name: true },
      })

      return candidates
        .filter((c) => c.id !== distributor.companyId)
        .filter((c) => {
          const candidateName = normalizeName(c.name)
          return (
            candidateName.length > 0 &&
            (target.includes(candidateName) || candidateName.includes(target))
          )
        })
        .map((c) => ({ companyId: c.id, companyName: c.name }))
    })
  }

  /** Mirrors `ClinicalTrialService.requireReadAccess()`'s own reasoning — a single ANDed `@RequirePermissions()` can't express "view or manage" as alternatives. */
  private async requireReadAccess(actor: AuthenticatedUser): Promise<void> {
    const permissions = await this.rolesService.getPermissionsForUser(actor)
    if (
      permissions.has('reconciliation.view') ||
      permissions.has('reconciliation.manage') ||
      permissions.has('records.view_all')
    ) {
      return
    }
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to view distributors',
    })
  }
}
