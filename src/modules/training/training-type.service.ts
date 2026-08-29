import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { TrainingTypeCatalogEntry } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { CreateTrainingTypeDto } from './dto/create-training-type.dto'
import { UpdateTrainingTypeDto } from './dto/update-training-type.dto'

export interface RequestMeta {
  ip?: string
}

/**
 * Special Corner SC-8 (Admin Configuration Console — training-type
 * catalog, todo-vigicloud.md 16.6-A) — "PPB Academy" only makes sense
 * for a Kenya-market company; this replaces the frontend's previous
 * hardcoded 4-option dropdown with a real, per-country-configurable
 * catalog, mirroring `RegulatoryAuthority`'s own "open GET, gated
 * POST/PATCH" precedent from Admin Config Console Gap 2 exactly.
 * Plain CRUD, not version-on-write — an entry's own identity doesn't
 * need audit-trailed history the way a *rule* does (see the schema's
 * own doc comment on `TrainingTypeCatalogEntry`).
 */
@Injectable()
export class TrainingTypeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * `countryId` omitted → resolves the caller's own tenant home country
   * automatically (the real-world case: `LogTrainingModal` never needs
   * to know or pass it). An explicit `countryId` (used by the admin
   * screen, which has no home country of its own) always wins. Always
   * includes the generic, market-agnostic rows (`countryId: null`) —
   * "Internal"/"Other" belong on every list.
   */
  async list(
    actor: AuthenticatedUser,
    countryId?: string,
    includeInactive = false,
  ): Promise<TrainingTypeCatalogEntry[]> {
    const resolvedCountryId =
      countryId ??
      (actor.companyId
        ? (await this.prisma.company.findUnique({ where: { id: actor.companyId } }))?.homeCountryId
        : undefined)

    return this.prisma.trainingTypeCatalogEntry.findMany({
      where: {
        ...(includeInactive ? {} : { active: true }),
        OR: [{ countryId: null }, ...(resolvedCountryId ? [{ countryId: resolvedCountryId }] : [])],
      },
      orderBy: [{ countryId: 'asc' }, { sortOrder: 'asc' }],
    })
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateTrainingTypeDto,
    meta: RequestMeta,
  ): Promise<TrainingTypeCatalogEntry> {
    const countryId = dto.countryId ?? null
    const duplicate = await this.prisma.trainingTypeCatalogEntry.findFirst({
      where: { countryId, typeKey: dto.typeKey },
    })
    if (duplicate) {
      throw new ConflictException({
        code: 'TRAINING_TYPE_ALREADY_EXISTS',
        message: `A training type with key "${dto.typeKey}" already exists for this scope`,
      })
    }

    const created = await this.prisma.trainingTypeCatalogEntry.create({
      data: {
        id: newId(),
        countryId,
        typeKey: dto.typeKey,
        label: dto.label,
        sortOrder: dto.sortOrder ?? 0,
        active: dto.active ?? true,
      },
    })

    await this.auditService.log(this.prisma, {
      actorUserId: actor.sub,
      action: 'training_type_created',
      recordType: 'training_type_catalog_entry',
      recordId: created.id,
      newValue: { countryId, typeKey: dto.typeKey, label: dto.label },
      ip: meta.ip,
    })

    return created
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateTrainingTypeDto,
    meta: RequestMeta,
  ): Promise<TrainingTypeCatalogEntry> {
    const existing = await this.prisma.trainingTypeCatalogEntry.findUnique({ where: { id } })
    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Training type not found' })
    }

    const updated = await this.prisma.trainingTypeCatalogEntry.update({
      where: { id },
      data: { label: dto.label, sortOrder: dto.sortOrder, active: dto.active },
    })

    await this.auditService.log(this.prisma, {
      actorUserId: actor.sub,
      action: 'training_type_updated',
      recordType: 'training_type_catalog_entry',
      recordId: id,
      oldValue: existing,
      newValue: updated,
      ip: meta.ip,
    })

    return updated
  }
}
