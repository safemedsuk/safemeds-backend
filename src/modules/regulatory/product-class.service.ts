import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ProductClassDefinition } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { CreateProductClassDto } from './dto/create-product-class.dto'
import { UpdateProductClassDto } from './dto/update-product-class.dto'

export interface RequestMeta {
  ip?: string
}

/**
 * Admin Configurability checklist item 4 — a real, admin-editable
 * pick-list for the `productClass` free-text field, a direct structural
 * copy of `TrainingTypeService`'s own pattern (see
 * `ProductClassDefinition`'s own schema doc comment for why this is
 * plain CRUD, not version-on-write). `authorityId` omitted → resolves
 * every authority-specific row plus the generic (`authorityId: null`)
 * ones, mirroring `TrainingTypeService.list()`'s own "always include the
 * market-agnostic rows" behavior.
 */
@Injectable()
export class ProductClassService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(authorityId?: string, includeInactive = false): Promise<ProductClassDefinition[]> {
    return this.prisma.productClassDefinition.findMany({
      where: {
        ...(includeInactive ? {} : { active: true }),
        OR: [{ authorityId: null }, ...(authorityId ? [{ authorityId }] : [])],
      },
      orderBy: [{ authorityId: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
    })
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateProductClassDto,
    meta: RequestMeta,
  ): Promise<ProductClassDefinition> {
    const authorityId = dto.authorityId ?? null
    const duplicate = await this.prisma.productClassDefinition.findFirst({
      where: { authorityId, classKey: dto.classKey },
    })
    if (duplicate) {
      throw new ConflictException({
        code: 'PRODUCT_CLASS_ALREADY_EXISTS',
        message: `A product class with key "${dto.classKey}" already exists for this scope`,
      })
    }

    const created = await this.prisma.productClassDefinition.create({
      data: {
        id: newId(),
        authorityId,
        classKey: dto.classKey,
        label: dto.label,
        description: dto.description,
        sourceReference: dto.sourceReference,
        sortOrder: dto.sortOrder ?? 0,
        active: dto.active ?? true,
      },
    })

    await this.auditService.log(this.prisma, {
      actorUserId: actor.sub,
      action: 'product_class_created',
      recordType: 'product_class_definition',
      recordId: created.id,
      newValue: { authorityId, classKey: dto.classKey, label: dto.label },
      ip: meta.ip,
    })

    return created
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateProductClassDto,
    meta: RequestMeta,
  ): Promise<ProductClassDefinition> {
    const existing = await this.prisma.productClassDefinition.findUnique({ where: { id } })
    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product class not found' })
    }

    const updated = await this.prisma.productClassDefinition.update({
      where: { id },
      data: {
        label: dto.label,
        description: dto.description,
        sourceReference: dto.sourceReference,
        sortOrder: dto.sortOrder,
        active: dto.active,
      },
    })

    await this.auditService.log(this.prisma, {
      actorUserId: actor.sub,
      action: 'product_class_updated',
      recordType: 'product_class_definition',
      recordId: id,
      oldValue: existing,
      newValue: updated,
      ip: meta.ip,
    })

    return updated
  }
}
