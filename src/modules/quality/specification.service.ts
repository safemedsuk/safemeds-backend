import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CreateSpecificationDto } from './dto/create-specification.dto'
import { ListSpecificationsQueryDto } from './dto/list-specifications-query.dto'
import { UpdateSpecificationDto } from './dto/update-specification.dto'

export interface RequestMeta {
  ip?: string
}

const withParameters = { parameters: { orderBy: { sortOrder: 'asc' as const } } }
type SpecificationWithParameters = Prisma.SpecificationGetPayload<{
  include: typeof withParameters
}>

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Specifications are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 0.1 — the product/material specification
 * register, a lighter-weight sibling to `Sop` (see that model's own
 * schema doc comment for why it's kept separate). Same bare-CRUD,
 * stage-split discipline as `SopService` — a specification's own
 * approval lifecycle is Stage 1's job; this stage lets one be drafted
 * with its structured `SpecificationParameter` rows.
 */
@Injectable()
export class SpecificationService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListSpecificationsQueryDto,
  ): Promise<PaginatedResult<SpecificationWithParameters>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.SpecificationWhereInput = {
        companyId,
        ...(query.q
          ? {
              OR: [
                { title: { contains: query.q, mode: 'insensitive' } },
                { specificationNumber: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...(query.specificationType ? { specificationType: query.specificationType } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.specification.findMany({
          where,
          include: withParameters,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.specification.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<SpecificationWithParameters> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.specification.findFirst({
        where: { id, companyId },
        include: withParameters,
      })
      if (!found)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Specification not found' })
      return found
    })
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateSpecificationDto,
    meta: RequestMeta,
  ): Promise<SpecificationWithParameters> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const duplicate = await tx.specification.findFirst({
        where: { companyId, specificationNumber: dto.specificationNumber },
      })
      if (duplicate) {
        throw new ConflictException({
          code: 'SPECIFICATION_NUMBER_TAKEN',
          message: `Specification number "${dto.specificationNumber}" is already in use`,
        })
      }

      const created = await tx.specification.create({
        data: {
          id: newId(),
          companyId,
          specificationNumber: dto.specificationNumber,
          title: dto.title,
          specificationType: dto.specificationType,
          productId: dto.productId ?? null,
          supplierId: dto.supplierId ?? null,
          status: 'draft',
          createdBy: actor.sub,
          parameters: dto.parameters
            ? {
                create: dto.parameters.map((p, index) => ({
                  id: newId(),
                  parameterName: p.parameterName,
                  testMethod: p.testMethod ?? null,
                  lowerLimit: p.lowerLimit ?? null,
                  upperLimit: p.upperLimit ?? null,
                  unit: p.unit ?? null,
                  sortOrder: p.sortOrder ?? index,
                })),
              }
            : undefined,
        },
        include: withParameters,
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'specification_created',
        recordType: 'specification',
        recordId: created.id,
        newValue: {
          specificationNumber: created.specificationNumber,
          title: created.title,
          parameterCount: created.parameters.length,
        },
        ip: meta.ip,
      })
      return created
    })
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateSpecificationDto,
    meta: RequestMeta,
  ): Promise<SpecificationWithParameters> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.specification.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Specification not found' })
      if (existing.status !== 'draft') {
        throw new ConflictException({
          code: 'NOT_DRAFT',
          message: 'Only a draft specification can be edited this way',
        })
      }

      if (dto.parameters) {
        await tx.specificationParameter.deleteMany({ where: { specificationId: id } })
      }

      const updated = await tx.specification.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.specificationType !== undefined
            ? { specificationType: dto.specificationType }
            : {}),
          ...(dto.productId !== undefined ? { productId: dto.productId } : {}),
          ...(dto.supplierId !== undefined ? { supplierId: dto.supplierId } : {}),
          ...(dto.parameters
            ? {
                parameters: {
                  create: dto.parameters.map((p, index) => ({
                    id: newId(),
                    parameterName: p.parameterName,
                    testMethod: p.testMethod ?? null,
                    lowerLimit: p.lowerLimit ?? null,
                    upperLimit: p.upperLimit ?? null,
                    unit: p.unit ?? null,
                    sortOrder: p.sortOrder ?? index,
                  })),
                },
              }
            : {}),
        },
        include: withParameters,
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'specification_updated',
        recordType: 'specification',
        recordId: id,
        newValue: { title: dto.title, parameterCount: dto.parameters?.length },
        ip: meta.ip,
      })
      return updated
    })
  }
}
