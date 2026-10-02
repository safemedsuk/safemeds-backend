import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, Supplier } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CreateSupplierDto } from './dto/create-supplier.dto'
import { ListSuppliersQueryDto } from './dto/list-suppliers-query.dto'
import { UpdateSupplierDto } from './dto/update-supplier.dto'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Suppliers are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 0.1 — the approved-supplier/vendor register.
 * Deliberately plain create/read/update — no delete — matching
 * `RegEntitiesService`'s exact "deactivate, never delete" shape, which is
 * itself a direct copy of `MasterDataService`'s own precedent.
 */
@Injectable()
export class SupplierService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListSuppliersQueryDto,
  ): Promise<PaginatedResult<Supplier>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.SupplierWhereInput = {
        companyId,
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
        ...(query.criticality ? { criticality: query.criticality } : {}),
        ...(query.approvalStatus ? { approvalStatus: query.approvalStatus } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.supplier.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.supplier.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Supplier> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.supplier.findFirst({ where: { id, companyId } })
      if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Supplier not found' })
      return found
    })
  }

  /**
   * Best-effort first match by name — mirrors
   * `RiskManagementPlanService.findProductByBrandName()`/
   * `RegEntitiesService.findManufacturerByName()`'s own exact precedent
   * and honest limitation: `Supplier.name` carries no schema-level
   * uniqueness constraint, so this can never be a guarantee. Kept for a
   * future bulk-import path (Stage 11) to match against without
   * duplicating.
   */
  async findByName(actor: AuthenticatedUser, name: string): Promise<Supplier | null> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.supplier.findFirst({
        where: { companyId, name: { equals: name, mode: 'insensitive' }, isActive: true },
      }),
    )
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateSupplierDto,
    meta: RequestMeta,
  ): Promise<Supplier> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.supplier.create({
        data: {
          id: newId(),
          companyId,
          name: dto.name,
          supplierType: dto.supplierType,
          countryId: dto.countryId ?? null,
          address: dto.address ?? null,
          criticality: dto.criticality ?? 'non_critical',
          manufacturerId: dto.manufacturerId ?? null,
          createdBy: actor.sub,
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'supplier_created',
        recordType: 'supplier',
        recordId: created.id,
        newValue: { name: created.name, supplierType: created.supplierType },
        ip: meta.ip,
      })
      return created
    })
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateSupplierDto,
    meta: RequestMeta,
  ): Promise<Supplier> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.supplier.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Supplier not found' })

      const updated = await tx.supplier.update({ where: { id }, data: dto })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'supplier_updated',
        recordType: 'supplier',
        recordId: id,
        oldValue: {
          approvalStatus: existing.approvalStatus,
          criticality: existing.criticality,
        },
        newValue: dto as Record<string, unknown>,
        ip: meta.ip,
      })
      return updated
    })
  }

  async deactivate(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<Supplier> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.supplier.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Supplier not found' })

      const updated = await tx.supplier.update({ where: { id }, data: { isActive: false } })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'supplier_deactivated',
        recordType: 'supplier',
        recordId: id,
        ip: meta.ip,
      })
      return updated
    })
  }
}
