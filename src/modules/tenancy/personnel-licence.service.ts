import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PersonnelLicence } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService, diffForAudit } from '../audit/audit.service'
import { CreatePersonnelLicenceDto } from './dto/create-personnel-licence.dto'
import { ListPersonnelLicencesQueryDto } from './dto/list-personnel-licences-query.dto'
import { UpdatePersonnelLicenceDto } from './dto/update-personnel-licence.dto'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Personnel licences are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * RegCloud (Phase 12) Stage 10 — Establishment/Premises & Personnel
 * Licensing, the personnel half. A regulatory fact about a *person* —
 * deliberately not folded into `User` itself, same reasoning
 * `QppvNomination` already established. Never delete, only mark
 * `status: 'expired' | 'suspended' | 'revoked'` — matching this project's
 * blanket "never delete, always deactivate" rule.
 */
@Injectable()
export class PersonnelLicenceService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListPersonnelLicencesQueryDto,
  ): Promise<PaginatedResult<PersonnelLicence>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = {
        companyId,
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.status ? { status: query.status } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.personnelLicence.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.personnelLicence.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<PersonnelLicence> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const licence = await tx.personnelLicence.findFirst({ where: { id, companyId } })
      if (!licence)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Personnel licence not found' })
      return licence
    })
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreatePersonnelLicenceDto,
    meta: RequestMeta,
  ): Promise<PersonnelLicence> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const user = await tx.user.findFirst({ where: { id: dto.userId, companyId } })
      if (!user)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'User not found in this company',
        })

      const created = await tx.personnelLicence.create({
        data: {
          id: newId(),
          companyId,
          userId: dto.userId,
          licenceType: dto.licenceType,
          licenceNumber: dto.licenceNumber,
          issuedOn: new Date(dto.issuedOn),
          expiresOn: dto.expiresOn ? new Date(dto.expiresOn) : undefined,
          licenceDocumentId: dto.licenceDocumentId,
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'personnel_licence_created',
        recordType: 'personnel_licence',
        recordId: created.id,
        newValue: {
          userId: dto.userId,
          licenceType: dto.licenceType,
          licenceNumber: dto.licenceNumber,
        },
        ip: meta.ip,
      })

      return created
    })
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdatePersonnelLicenceDto,
    meta: RequestMeta,
  ): Promise<PersonnelLicence> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.personnelLicence.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Personnel licence not found' })

      const updated = await tx.personnelLicence.update({
        where: { id },
        data: {
          ...(dto.licenceNumber !== undefined ? { licenceNumber: dto.licenceNumber } : {}),
          ...(dto.issuedOn !== undefined ? { issuedOn: new Date(dto.issuedOn) } : {}),
          // Clears the "already reminded" guard for the same reason
          // `FacilitiesService.updateLicence()` does — a new expiry date
          // is a fresh renewal cycle.
          ...(dto.expiresOn !== undefined
            ? { expiresOn: new Date(dto.expiresOn), renewalNotifiedAt: null }
            : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.licenceDocumentId !== undefined
            ? { licenceDocumentId: dto.licenceDocumentId }
            : {}),
        },
      })
      const diff = diffForAudit(existing, updated)

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'personnel_licence_updated',
        recordType: 'personnel_licence',
        recordId: id,
        oldValue: diff.oldValue,
        newValue: diff.newValue,
        ip: meta.ip,
      })

      return updated
    })
  }
}
