import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditFinding, InternalAudit } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult, PaginationQueryDto } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CreateAuditFindingDto } from './dto/create-audit-finding.dto'
import { CreateInternalAuditDto } from './dto/create-internal-audit.dto'
import { UpdateInternalAuditDto } from './dto/update-internal-audit.dto'

export interface RequestMeta {
  ip?: string
}

export const INTERNAL_AUDIT_RECORD_TYPE = 'internal_audit'
export const AUDIT_FINDING_RECORD_TYPE = 'audit_finding'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Internal audits are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * VigiCloud Stage 16.3 — schedule internal audits and log findings
 * against them. A plain, direct-status-transition service, not a
 * `WorkflowService` instance (see `InternalAudit`'s own schema doc
 * comment for why). CAPA management itself lives in `CapaService`
 * (same module, separate file — a CAPA can also be raised standalone,
 * not only from a finding).
 */
@Injectable()
export class InternalAuditService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    dto: CreateInternalAuditDto,
    meta: RequestMeta,
  ): Promise<InternalAudit> {
    const companyId = requireCompany(actor)
    const auditScope = dto.auditScope ?? 'internal'
    if (auditScope === 'supplier' && !dto.supplierId) {
      throw new BadRequestException({
        code: 'SUPPLIER_REQUIRED',
        message: 'A supplier-scope audit requires the supplier being audited.',
      })
    }

    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.internalAudit.create({
        data: {
          id: newId(),
          companyId,
          title: dto.title,
          scope: dto.scope ?? null,
          auditScope,
          supplierId: auditScope === 'supplier' ? dto.supplierId : null,
          scheduledDate: new Date(dto.scheduledDate),
          leadAuditorUserId: dto.leadAuditorUserId ?? null,
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'internal_audit_scheduled',
        recordType: INTERNAL_AUDIT_RECORD_TYPE,
        recordId: created.id,
        newValue: { title: created.title, scheduledDate: created.scheduledDate },
        ip: meta.ip,
      })

      return created
    })
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateInternalAuditDto,
    meta: RequestMeta,
  ): Promise<InternalAudit> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.internalAudit.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Internal audit not found' })
      }

      const updated = await tx.internalAudit.update({ where: { id }, data: dto })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'internal_audit_updated',
        recordType: INTERNAL_AUDIT_RECORD_TYPE,
        recordId: id,
        oldValue: { status: existing.status },
        newValue: dto as Record<string, unknown>,
        ip: meta.ip,
      })

      return updated
    })
  }

  async list(
    actor: AuthenticatedUser,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<InternalAudit>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = { companyId }
      const [rows, total] = await Promise.all([
        tx.internalAudit.findMany({
          where,
          orderBy: { scheduledDate: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.internalAudit.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<InternalAudit & { findings: AuditFinding[] }> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.internalAudit.findFirst({
        where: { id, companyId },
        include: { findings: { orderBy: { createdAt: 'desc' } } },
      })
      if (!found) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Internal audit not found' })
      }
      return found
    })
  }

  async addFinding(
    actor: AuthenticatedUser,
    auditId: string,
    dto: CreateAuditFindingDto,
    meta: RequestMeta,
  ): Promise<AuditFinding> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const audit = await tx.internalAudit.findFirst({ where: { id: auditId, companyId } })
      if (!audit) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Internal audit not found' })
      }

      const created = await tx.auditFinding.create({
        data: {
          id: newId(),
          companyId,
          auditId,
          description: dto.description,
          severity: dto.severity,
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'audit_finding_logged',
        recordType: AUDIT_FINDING_RECORD_TYPE,
        recordId: created.id,
        newValue: { auditId, severity: created.severity },
        ip: meta.ip,
      })

      return created
    })
  }

  async listFindings(
    actor: AuthenticatedUser,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<AuditFinding>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = { companyId }
      const [rows, total] = await Promise.all([
        tx.auditFinding.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.auditFinding.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }
}
