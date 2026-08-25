import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ImportExportPermit } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService, diffForAudit } from '../audit/audit.service'
import { CreateImportExportPermitDto } from './dto/create-import-export-permit.dto'
import { ListImportExportPermitsQueryDto } from './dto/list-import-export-permits-query.dto'
import { UpdateImportExportPermitDto } from './dto/update-import-export-permit.dto'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Import/export permits are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * RegCloud (Phase 12) Stage 11 — Import/Export & Permits. A deliberately
 * lightweight CRUD + deadline-reminder record (see `ImportExportPermit`'s
 * own schema doc comment for the full scoping reasoning) — plain
 * create/update/list/get, `RegLicensingExpiryService` handles the
 * expiry-scan/escalation half directly off `validTo`, no workflow engine
 * involved. Never delete, only mark `status: 'revoked'`/`'expired'`.
 */
@Injectable()
export class ImportExportPermitService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListImportExportPermitsQueryDto,
  ): Promise<PaginatedResult<ImportExportPermit>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = {
        companyId,
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.clinicalTrialId ? { clinicalTrialId: query.clinicalTrialId } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.importExportPermit.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.importExportPermit.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<ImportExportPermit> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const permit = await tx.importExportPermit.findFirst({ where: { id, companyId } })
      if (!permit) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Permit not found' })
      return permit
    })
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateImportExportPermitDto,
    meta: RequestMeta,
  ): Promise<ImportExportPermit> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const product = await tx.product.findFirst({ where: { id: dto.productId, companyId } })
      if (!product) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' })

      if (dto.productRegistrationId) {
        const registration = await tx.productRegistration.findFirst({
          where: { id: dto.productRegistrationId, companyId },
        })
        if (!registration)
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: 'Product registration not found',
          })
      }

      const authority = await tx.regulatoryAuthority.findUnique({ where: { id: dto.authorityId } })
      if (!authority)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Regulatory authority not found',
        })

      // RegCloud Stage 12 — an IMP permit's trial must be a real trial
      // belonging to this same company; RLS on `clinicalTrial` already
      // guarantees this lookup can't cross tenants.
      if (dto.clinicalTrialId) {
        const trial = await tx.clinicalTrial.findUnique({ where: { id: dto.clinicalTrialId } })
        if (!trial)
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Clinical trial not found' })
      }

      const created = await tx.importExportPermit.create({
        data: {
          id: newId(),
          companyId,
          productId: dto.productId,
          productRegistrationId: dto.productRegistrationId,
          authorityId: dto.authorityId,
          permitType: dto.permitType,
          permitNumber: dto.permitNumber,
          status: 'draft',
          validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
          validTo: dto.validTo ? new Date(dto.validTo) : undefined,
          permitDocumentId: dto.permitDocumentId,
          clinicalTrialId: dto.clinicalTrialId,
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'import_export_permit_created',
        recordType: 'import_export_permit',
        recordId: created.id,
        newValue: {
          productId: dto.productId,
          permitType: dto.permitType,
          authorityId: dto.authorityId,
          clinicalTrialId: dto.clinicalTrialId ?? null,
        },
        ip: meta.ip,
      })

      return created
    })
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateImportExportPermitDto,
    meta: RequestMeta,
  ): Promise<ImportExportPermit> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.importExportPermit.findFirst({ where: { id, companyId } })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Permit not found' })

      const updated = await tx.importExportPermit.update({
        where: { id },
        data: {
          ...(dto.permitNumber !== undefined ? { permitNumber: dto.permitNumber } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.validFrom !== undefined ? { validFrom: new Date(dto.validFrom) } : {}),
          // Clears the "already reminded" guard — a new expiry date is a
          // fresh renewal cycle, same precedent as `FacilitiesService
          // .updateLicence()`/`PersonnelLicenceService.update()`.
          ...(dto.validTo !== undefined
            ? { validTo: new Date(dto.validTo), renewalNotifiedAt: null }
            : {}),
          ...(dto.permitDocumentId !== undefined ? { permitDocumentId: dto.permitDocumentId } : {}),
        },
      })
      const diff = diffForAudit(existing, updated)

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'import_export_permit_updated',
        recordType: 'import_export_permit',
        recordId: id,
        oldValue: diff.oldValue,
        newValue: diff.newValue,
        ip: meta.ip,
      })

      return updated
    })
  }
}
