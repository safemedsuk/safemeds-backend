import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { LocalRepresentative, Manufacturer, ManufacturingSite, Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CreateLocalRepresentativeDto } from './dto/create-local-representative.dto'
import { CreateManufacturerDto } from './dto/create-manufacturer.dto'
import { CreateManufacturingSiteDto } from './dto/create-manufacturing-site.dto'
import { ListLocalRepresentativesQueryDto } from './dto/list-local-representatives-query.dto'
import { ListManufacturersQueryDto } from './dto/list-manufacturers-query.dto'
import { ListManufacturingSitesQueryDto } from './dto/list-manufacturing-sites-query.dto'
import { UpdateLocalRepresentativeDto } from './dto/update-local-representative.dto'
import { UpdateManufacturerDto } from './dto/update-manufacturer.dto'
import { UpdateManufacturingSiteDto } from './dto/update-manufacturing-site.dto'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Regulatory entities are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * RegCloud (Phase 12) Stage 0.2 — the Regulatory Entity & Hierarchy Model's
 * own CRUD: manufacturers, their manufacturing sites, and local
 * representatives. Deliberately plain create/read/update — no delete —
 * matching `MasterDataService`'s exact "deactivate, never delete" shape
 * (this file's structure is a direct copy of that one's, same reasoning).
 */
@Injectable()
export class RegEntitiesService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  // ── Manufacturers ─────────────────────────────────────────────────────

  async listManufacturers(
    actor: AuthenticatedUser,
    query: ListManufacturersQueryDto,
  ): Promise<PaginatedResult<Manufacturer>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.ManufacturerWhereInput = {
        companyId,
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.manufacturer.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.manufacturer.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  /**
   * testing-correction-explanation.md §4.1 — the bulk-entities importer's
   * "match an existing manufacturer by name before creating a duplicate"
   * lookup, mirroring `RiskManagementPlanService.findProductByBrandName()`'s
   * own exact shape (and its own honest limitation: `Manufacturer.name`
   * carries no schema-level uniqueness constraint, so this is a
   * best-effort first match, not a guarantee).
   */
  async findManufacturerByName(
    actor: AuthenticatedUser,
    name: string,
  ): Promise<Manufacturer | null> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.manufacturer.findFirst({
        where: { companyId, name: { equals: name, mode: 'insensitive' }, isActive: true },
      }),
    )
  }

  async createManufacturer(
    actor: AuthenticatedUser,
    dto: CreateManufacturerDto,
    meta: RequestMeta,
  ): Promise<Manufacturer> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.manufacturer.create({ data: { id: newId(), companyId, ...dto } })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'manufacturer_created',
        recordType: 'manufacturer',
        recordId: created.id,
        newValue: { ...dto },
        ip: meta.ip,
      })
      return created
    })
  }

  async updateManufacturer(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateManufacturerDto,
    meta: RequestMeta,
  ): Promise<Manufacturer> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.manufacturer.findUnique({ where: { id } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Manufacturer not found' })

      const updated = await tx.manufacturer.update({ where: { id }, data: dto })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'manufacturer_updated',
        recordType: 'manufacturer',
        recordId: id,
        newValue: dto as Record<string, unknown>,
        ip: meta.ip,
      })
      return updated
    })
  }

  async deactivateManufacturer(
    actor: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<Manufacturer> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.manufacturer.findUnique({ where: { id } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Manufacturer not found' })

      const updated = await tx.manufacturer.update({ where: { id }, data: { isActive: false } })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'manufacturer_deactivated',
        recordType: 'manufacturer',
        recordId: id,
        ip: meta.ip,
      })
      return updated
    })
  }

  // ── Manufacturing sites ───────────────────────────────────────────────

  async listManufacturingSites(
    actor: AuthenticatedUser,
    query: ListManufacturingSitesQueryDto,
  ): Promise<PaginatedResult<ManufacturingSite>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.ManufacturingSiteWhereInput = {
        companyId,
        ...(query.manufacturerId ? { manufacturerId: query.manufacturerId } : {}),
        ...(query.q ? { siteName: { contains: query.q, mode: 'insensitive' } } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.manufacturingSite.findMany({
          where,
          orderBy: { siteName: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.manufacturingSite.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async createManufacturingSite(
    actor: AuthenticatedUser,
    dto: CreateManufacturingSiteDto,
    meta: RequestMeta,
  ): Promise<ManufacturingSite> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const manufacturer = await tx.manufacturer.findUnique({ where: { id: dto.manufacturerId } })
      if (!manufacturer)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Manufacturer not found' })

      const created = await tx.manufacturingSite.create({
        data: {
          id: newId(),
          companyId,
          manufacturerId: dto.manufacturerId,
          siteName: dto.siteName,
          countryId: dto.countryId,
          address: dto.address,
          gmpCertificateNumber: dto.gmpCertificateNumber,
          gmpCertificateExpiresOn: dto.gmpCertificateExpiresOn
            ? new Date(dto.gmpCertificateExpiresOn)
            : undefined,
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'manufacturing_site_created',
        recordType: 'manufacturing_site',
        recordId: created.id,
        newValue: { manufacturerId: dto.manufacturerId, siteName: dto.siteName },
        ip: meta.ip,
      })
      return created
    })
  }

  async updateManufacturingSite(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateManufacturingSiteDto,
    meta: RequestMeta,
  ): Promise<ManufacturingSite> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.manufacturingSite.findUnique({ where: { id } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Manufacturing site not found' })

      const updated = await tx.manufacturingSite.update({
        where: { id },
        data: {
          ...(dto.siteName !== undefined ? { siteName: dto.siteName } : {}),
          ...(dto.countryId !== undefined ? { countryId: dto.countryId } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
          ...(dto.gmpCertificateNumber !== undefined
            ? { gmpCertificateNumber: dto.gmpCertificateNumber }
            : {}),
          ...(dto.gmpCertificateExpiresOn !== undefined
            ? { gmpCertificateExpiresOn: new Date(dto.gmpCertificateExpiresOn) }
            : {}),
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'manufacturing_site_updated',
        recordType: 'manufacturing_site',
        recordId: id,
        newValue: dto as Record<string, unknown>,
        ip: meta.ip,
      })
      return updated
    })
  }

  async deactivateManufacturingSite(
    actor: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<ManufacturingSite> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.manufacturingSite.findUnique({ where: { id } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Manufacturing site not found' })

      const updated = await tx.manufacturingSite.update({
        where: { id },
        data: { isActive: false },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'manufacturing_site_deactivated',
        recordType: 'manufacturing_site',
        recordId: id,
        ip: meta.ip,
      })
      return updated
    })
  }

  // ── Local representatives ─────────────────────────────────────────────

  async listLocalRepresentatives(
    actor: AuthenticatedUser,
    query: ListLocalRepresentativesQueryDto,
  ): Promise<PaginatedResult<LocalRepresentative>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.LocalRepresentativeWhereInput = {
        companyId,
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.localRepresentative.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.localRepresentative.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async createLocalRepresentative(
    actor: AuthenticatedUser,
    dto: CreateLocalRepresentativeDto,
    meta: RequestMeta,
  ): Promise<LocalRepresentative> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.localRepresentative.create({
        data: { id: newId(), companyId, ...dto },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'local_representative_created',
        recordType: 'local_representative',
        recordId: created.id,
        newValue: { name: dto.name },
        ip: meta.ip,
      })
      return created
    })
  }

  async updateLocalRepresentative(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateLocalRepresentativeDto,
    meta: RequestMeta,
  ): Promise<LocalRepresentative> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.localRepresentative.findUnique({ where: { id } })
      if (!existing)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Local representative not found',
        })

      const updated = await tx.localRepresentative.update({ where: { id }, data: dto })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'local_representative_updated',
        recordType: 'local_representative',
        recordId: id,
        newValue: dto as Record<string, unknown>,
        ip: meta.ip,
      })
      return updated
    })
  }

  async deactivateLocalRepresentative(
    actor: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<LocalRepresentative> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.localRepresentative.findUnique({ where: { id } })
      if (!existing)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Local representative not found',
        })

      const updated = await tx.localRepresentative.update({
        where: { id },
        data: { isActive: false },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'local_representative_deactivated',
        recordType: 'local_representative',
        recordId: id,
        ip: meta.ip,
      })
      return updated
    })
  }
}
