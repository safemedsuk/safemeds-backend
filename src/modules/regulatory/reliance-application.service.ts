import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { RelianceApplication } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { AddParticipatingAuthorityDto } from './dto/add-participating-authority.dto'
import { CreateRelianceApplicationDto } from './dto/create-reliance-application.dto'
import { ListRelianceApplicationsQueryDto } from './dto/list-reliance-applications-query.dto'
import { StartAuthorityDossierDto } from './dto/start-authority-dossier.dto'
import { RegDossierService, RegDossierWithSlots } from './reg-dossier.service'

export interface RequestMeta {
  ip?: string
}

export interface RelianceApplicationAuthorityStatus {
  authorityId: string
  authorityName: string
  authorityCode: string
  isLead: boolean
  dossier: { id: string; status: string } | null
}

export type RelianceApplicationWithDetail = RelianceApplication & {
  product: { brandName: string }
  leadAuthority: { name: string; code: string }
  authorityStatuses: RelianceApplicationAuthorityStatus[]
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A reliance application is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * RegCloud (Phase 12) Stage 16 — Reliance Pathways. A real, deliberate
 * **two-step sequence, not one atomic transaction** for `create()` — the
 * `RelianceApplication` wrapper row is created first (a real FK target
 * `RegDossierService.create()`'s own `relianceApplicationId` validation
 * needs to already exist), then the lead authority's dossier is created
 * through the exact same `RegDossierService.create()` every other
 * dossier uses — mirroring `RegVariationService.create()`'s own
 * documented tolerance for this shape exactly (see that service's own
 * doc comment for the full reasoning), just in the reverse order that
 * use case needs versus this one. Every OTHER participating authority's
 * dossier is deliberately **not** auto-created at the same time —
 * `startDossierForAuthority()` is a separate, explicit action, since a
 * relying market's own `productClass`/`route` isn't guaranteed to be
 * identical to the lead's.
 */
@Injectable()
export class RelianceApplicationService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly regDossierService: RegDossierService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListRelianceApplicationsQueryDto,
  ): Promise<
    PaginatedResult<
      RelianceApplication & {
        product: { brandName: string }
        leadAuthority: { name: string; code: string }
      }
    >
  > {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = { companyId, ...(query.productId ? { productId: query.productId } : {}) }
      const [rows, total] = await Promise.all([
        tx.relianceApplication.findMany({
          where,
          include: {
            product: { select: { brandName: true } },
            leadAuthority: { select: { name: true, code: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.relianceApplication.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<RelianceApplicationWithDetail> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.relianceApplication.findFirst({
        where: { id, companyId },
        include: {
          product: { select: { brandName: true } },
          leadAuthority: { select: { name: true, code: true } },
        },
      })
      if (!found)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Reliance application not found',
        })

      const authorityIds = [found.leadAuthorityId, ...found.participatingAuthorityIds]
      const [authorities, dossiers] = await Promise.all([
        tx.regulatoryAuthority.findMany({
          where: { id: { in: authorityIds } },
          select: { id: true, name: true, code: true },
        }),
        tx.regDossier.findMany({
          where: { relianceApplicationId: id },
          select: { id: true, authorityId: true, status: true },
        }),
      ])

      const authorityStatuses: RelianceApplicationAuthorityStatus[] = authorityIds.map(
        (authorityId) => {
          const authority = authorities.find((a) => a.id === authorityId)
          const dossier = dossiers.find((d) => d.authorityId === authorityId)
          return {
            authorityId,
            authorityName: authority?.name ?? 'Unknown authority',
            authorityCode: authority?.code ?? '?',
            isLead: authorityId === found.leadAuthorityId,
            dossier: dossier ? { id: dossier.id, status: dossier.status } : null,
          }
        },
      )

      return { ...found, authorityStatuses }
    })
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateRelianceApplicationDto,
    meta: RequestMeta,
  ): Promise<RelianceApplicationWithDetail & { leadDossier: RegDossierWithSlots }> {
    const companyId = requireCompany(actor)
    const participatingAuthorityIds = dto.participatingAuthorityIds ?? []

    const applicationId = await this.rls.runAsCompany(companyId, async (tx) => {
      const product = await tx.product.findFirst({ where: { id: dto.productId, companyId } })
      if (!product) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' })

      const leadAuthority = await tx.regulatoryAuthority.findUnique({
        where: { id: dto.leadAuthorityId },
      })
      if (!leadAuthority)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Lead regulatory authority not found',
        })

      for (const authorityId of participatingAuthorityIds) {
        const authority = await tx.regulatoryAuthority.findUnique({ where: { id: authorityId } })
        if (!authority)
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: `Participating authority not found: ${authorityId}`,
          })
      }

      const row = await tx.relianceApplication.create({
        data: {
          id: newId(),
          companyId,
          productId: dto.productId,
          pathwayType: dto.pathwayType,
          leadAuthorityId: dto.leadAuthorityId,
          participatingAuthorityIds,
          status: 'active',
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'reliance_application_created',
        recordType: 'reliance_application',
        recordId: row.id,
        newValue: {
          productId: dto.productId,
          pathwayType: dto.pathwayType,
          leadAuthorityId: dto.leadAuthorityId,
          participatingAuthorityIds,
        },
        ip: meta.ip,
      })

      return row.id
    })

    const leadDossier = await this.regDossierService.create(
      actor,
      {
        productId: dto.productId,
        authorityId: dto.leadAuthorityId,
        productClass: dto.productClass,
        route: dto.route,
        relianceApplicationId: applicationId,
      },
      meta,
    )

    const detail = await this.get(actor, applicationId)
    return { ...detail, leadDossier }
  }

  async addParticipatingAuthority(
    actor: AuthenticatedUser,
    id: string,
    dto: AddParticipatingAuthorityDto,
    meta: RequestMeta,
  ): Promise<RelianceApplicationWithDetail> {
    const companyId = requireCompany(actor)
    await this.rls.runAsCompany(companyId, async (tx) => {
      const application = await tx.relianceApplication.findFirst({ where: { id, companyId } })
      if (!application)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Reliance application not found',
        })

      if (
        dto.authorityId === application.leadAuthorityId ||
        application.participatingAuthorityIds.includes(dto.authorityId)
      ) {
        throw new ConflictException({
          code: 'AUTHORITY_ALREADY_LINKED',
          message: 'This authority is already part of this reliance application',
        })
      }

      const authority = await tx.regulatoryAuthority.findUnique({ where: { id: dto.authorityId } })
      if (!authority)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Regulatory authority not found',
        })

      await tx.relianceApplication.update({
        where: { id },
        data: {
          participatingAuthorityIds: [...application.participatingAuthorityIds, dto.authorityId],
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'reliance_application_authority_added',
        recordType: 'reliance_application',
        recordId: id,
        newValue: { authorityId: dto.authorityId },
        ip: meta.ip,
      })
    })

    return this.get(actor, id)
  }

  /** Starts the real per-authority dossier for one of this application's lead/participating authorities — deliberately a separate action from `create()`, see this service's own doc comment for why. */
  async startDossierForAuthority(
    actor: AuthenticatedUser,
    id: string,
    dto: StartAuthorityDossierDto,
    meta: RequestMeta,
  ): Promise<RegDossierWithSlots> {
    const companyId = requireCompany(actor)

    const application = await this.rls.runAsCompany(companyId, (tx) =>
      tx.relianceApplication.findFirst({ where: { id, companyId } }),
    )
    if (!application)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Reliance application not found' })

    const isKnownAuthority =
      dto.authorityId === application.leadAuthorityId ||
      application.participatingAuthorityIds.includes(dto.authorityId)
    if (!isKnownAuthority) {
      throw new ConflictException({
        code: 'AUTHORITY_NOT_LINKED',
        message: 'This authority is not part of this reliance application — add it first',
      })
    }

    const existing = await this.rls.runAsCompany(companyId, (tx) =>
      tx.regDossier.findFirst({
        where: { relianceApplicationId: id, authorityId: dto.authorityId },
      }),
    )
    if (existing) {
      throw new ConflictException({
        code: 'DOSSIER_ALREADY_STARTED',
        message: 'A dossier has already been started for this authority under this application',
      })
    }

    return this.regDossierService.create(
      actor,
      {
        productId: application.productId,
        authorityId: dto.authorityId,
        productClass: dto.productClass,
        route: dto.route,
        relianceApplicationId: id,
      },
      meta,
    )
  }

  async close(
    actor: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<RelianceApplication> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.relianceApplication.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Reliance application not found',
        })

      const updated = await tx.relianceApplication.update({
        where: { id },
        data: { status: 'closed' },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'reliance_application_closed',
        recordType: 'reliance_application',
        recordId: id,
        oldValue: { status: existing.status },
        newValue: { status: 'closed' },
        ip: meta.ip,
      })

      return updated
    })
  }
}
