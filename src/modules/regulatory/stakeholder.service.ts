import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, Stakeholder } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CreateStakeholderDto } from './dto/create-stakeholder.dto'
import { ListStakeholdersQueryDto } from './dto/list-stakeholders-query.dto'
import { UpdateStakeholderDto } from './dto/update-stakeholder.dto'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A stakeholder is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 10.3 — every organisation in a recall's
 * distribution tree, unlimited depth via self-referential `parentId`.
 * Deliberately plain create/read/update/deactivate, matching
 * `SupplierService`'s exact shape — a stakeholder is master data, not a
 * workflow-backed record.
 */
@Injectable()
export class StakeholderService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListStakeholdersQueryDto,
  ): Promise<PaginatedResult<Stakeholder>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.StakeholderWhereInput = {
        companyId,
        ...(query.q ? { orgName: { contains: query.q, mode: 'insensitive' } } : {}),
        ...(query.parentId ? { parentId: query.parentId } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.stakeholder.findMany({
          where,
          orderBy: { orgName: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.stakeholder.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Stakeholder> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.stakeholder.findFirst({ where: { id, companyId } })
      if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Stakeholder not found' })
      return found
    })
  }

  /** Best-effort first match by name — the auto-match a `RecallImportJob` row and `ComplaintService`-style reconciliation both rely on. `orgName` carries no uniqueness constraint, matching `Supplier.name`'s own established, honest limitation. */
  async findByName(actor: AuthenticatedUser, orgName: string): Promise<Stakeholder | null> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.stakeholder.findFirst({
        where: { companyId, orgName: { equals: orgName, mode: 'insensitive' }, isActive: true },
      }),
    )
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateStakeholderDto,
    meta: RequestMeta,
  ): Promise<Stakeholder> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      if (dto.parentId) {
        const parent = await tx.stakeholder.findFirst({ where: { id: dto.parentId, companyId } })
        if (!parent) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Parent stakeholder not found' })
      }
      const created = await tx.stakeholder.create({
        data: {
          id: newId(),
          companyId,
          orgName: dto.orgName,
          type: dto.type,
          country: dto.country ?? null,
          licenceNo: dto.licenceNo ?? null,
          licenceStatus: dto.licenceStatus ?? null,
          parentId: dto.parentId ?? null,
          contactName: dto.contactName ?? null,
          contactPhone: dto.contactPhone ?? null,
          contactEmail: dto.contactEmail ?? null,
          contactWhatsapp: dto.contactWhatsapp ?? null,
          createdBy: actor.sub,
        },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'stakeholder_created',
        recordType: 'stakeholder',
        recordId: created.id,
        newValue: { orgName: created.orgName, type: created.type },
        ip: meta.ip,
      })
      return created
    })
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateStakeholderDto,
    meta: RequestMeta,
  ): Promise<Stakeholder> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.stakeholder.findFirst({ where: { id, companyId } })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Stakeholder not found' })
      const updated = await tx.stakeholder.update({ where: { id }, data: dto })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'stakeholder_updated',
        recordType: 'stakeholder',
        recordId: id,
        newValue: dto as Record<string, unknown>,
        ip: meta.ip,
      })
      return updated
    })
  }

  async deactivate(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<Stakeholder> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.stakeholder.findFirst({ where: { id, companyId } })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Stakeholder not found' })
      const updated = await tx.stakeholder.update({ where: { id }, data: { isActive: false } })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'stakeholder_deactivated',
        recordType: 'stakeholder',
        recordId: id,
        ip: meta.ip,
      })
      return updated
    })
  }
}
