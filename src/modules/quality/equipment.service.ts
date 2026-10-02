import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Equipment, Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CreateEquipmentDto } from './dto/create-equipment.dto'
import { ListEquipmentQueryDto } from './dto/list-equipment-query.dto'
import { UpdateEquipmentDto } from './dto/update-equipment.dto'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Equipment is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 0.1 — the equipment/instrument register.
 * Same plain create/read/update/deactivate shape as `SupplierService`.
 * The real DQ→IQ→OQ→PQ qualification *workflow* (protocols, execution,
 * sign-off) is Stage 14's own build — this stage only creates the
 * entity and lets its `qualificationStatus`/calibration/maintenance
 * dates be set directly, matching the project's own stage-split
 * discipline.
 */
@Injectable()
export class EquipmentService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListEquipmentQueryDto,
  ): Promise<PaginatedResult<Equipment>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.EquipmentWhereInput = {
        companyId,
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
        ...(query.facilityId ? { facilityId: query.facilityId } : {}),
        ...(query.qualificationStatus ? { qualificationStatus: query.qualificationStatus } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.equipment.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.equipment.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Equipment> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.equipment.findFirst({ where: { id, companyId } })
      if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Equipment not found' })
      return found
    })
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateEquipmentDto,
    meta: RequestMeta,
  ): Promise<Equipment> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      if (dto.facilityId) {
        const facility = await tx.facility.findFirst({ where: { id: dto.facilityId, companyId } })
        if (!facility)
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Facility not found' })
      }

      const created = await tx.equipment.create({
        data: {
          id: newId(),
          companyId,
          facilityId: dto.facilityId ?? null,
          name: dto.name,
          equipmentType: dto.equipmentType,
          assetTag: dto.assetTag ?? null,
          qualificationStatus: dto.qualificationStatus ?? 'not_qualified',
          calibrationDueAt: dto.calibrationDueAt ? new Date(dto.calibrationDueAt) : null,
          lastCalibratedAt: dto.lastCalibratedAt ? new Date(dto.lastCalibratedAt) : null,
          maintenanceDueAt: dto.maintenanceDueAt ? new Date(dto.maintenanceDueAt) : null,
          createdBy: actor.sub,
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'equipment_created',
        recordType: 'equipment',
        recordId: created.id,
        newValue: { name: created.name, equipmentType: created.equipmentType },
        ip: meta.ip,
      })
      return created
    })
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateEquipmentDto,
    meta: RequestMeta,
  ): Promise<Equipment> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.equipment.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Equipment not found' })

      const updated = await tx.equipment.update({
        where: { id },
        data: {
          ...(dto.facilityId !== undefined ? { facilityId: dto.facilityId } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.equipmentType !== undefined ? { equipmentType: dto.equipmentType } : {}),
          ...(dto.assetTag !== undefined ? { assetTag: dto.assetTag } : {}),
          ...(dto.qualificationStatus !== undefined
            ? { qualificationStatus: dto.qualificationStatus }
            : {}),
          ...(dto.calibrationDueAt !== undefined
            ? { calibrationDueAt: new Date(dto.calibrationDueAt) }
            : {}),
          ...(dto.lastCalibratedAt !== undefined
            ? { lastCalibratedAt: new Date(dto.lastCalibratedAt) }
            : {}),
          ...(dto.maintenanceDueAt !== undefined
            ? { maintenanceDueAt: new Date(dto.maintenanceDueAt) }
            : {}),
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'equipment_updated',
        recordType: 'equipment',
        recordId: id,
        oldValue: { qualificationStatus: existing.qualificationStatus },
        newValue: dto as Record<string, unknown>,
        ip: meta.ip,
      })
      return updated
    })
  }

  async deactivate(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<Equipment> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.equipment.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Equipment not found' })

      const updated = await tx.equipment.update({ where: { id }, data: { isActive: false } })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'equipment_deactivated',
        recordType: 'equipment',
        recordId: id,
        ip: meta.ip,
      })
      return updated
    })
  }
}
