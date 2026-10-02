import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Sdea } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult, PaginationQueryDto } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { AttachSdeaDocumentDto } from './dto/attach-sdea-document.dto'
import { CreateSdeaDto } from './dto/create-sdea.dto'

export interface RequestMeta {
  ip?: string
}

export const SDEA_RECORD_TYPE = 'sdea'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'SDEAs are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * VigiCloud Stage 16.5 — version-on-write per distributor, mirroring
 * `PsmfService`'s exact shape (`create()` → draft, `attachDocument()`,
 * `activate()` supersedes the previous active row) — see `Sdea`'s own
 * schema doc comment for why this repo's usual DB-level partial unique
 * index isn't used here. "Standard or custom templates" (Final doc) is
 * `templateUsed` — a plain descriptive string, not a bespoke template
 * repository; the actual signed document is always a real upload via
 * the generic Documents pipeline, template or not.
 */
@Injectable()
export class SdeaService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateSdeaDto, meta: RequestMeta): Promise<Sdea> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const distributor = await tx.distributor.findFirst({
        where: { id: dto.distributorId, companyId },
      })
      if (!distributor) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Distributor not found' })
      }

      const latest = await tx.sdea.findFirst({
        where: { companyId, distributorId: dto.distributorId },
        orderBy: { version: 'desc' },
      })
      const nextVersion = (latest?.version ?? 0) + 1

      const created = await tx.sdea.create({
        data: {
          id: newId(),
          companyId,
          distributorId: dto.distributorId,
          title: dto.title,
          counterpartyName: dto.counterpartyName,
          templateUsed: dto.templateUsed ?? null,
          version: nextVersion,
          receivedDate: dto.receivedDate ? new Date(dto.receivedDate) : null,
          effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : null,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'sdea_draft_created',
        recordType: SDEA_RECORD_TYPE,
        recordId: created.id,
        newValue: { distributorId: dto.distributorId, version: created.version },
        ip: meta.ip,
      })

      return created
    })
  }

  async attachDocument(
    actor: AuthenticatedUser,
    id: string,
    dto: AttachSdeaDocumentDto,
    meta: RequestMeta,
  ): Promise<Sdea> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.sdea.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'SDEA draft not found' })
      }
      if (existing.status !== 'draft') {
        throw new ConflictException({
          code: 'NOT_A_DRAFT',
          message: 'Only a draft SDEA can have its document changed',
        })
      }

      const document = await tx.document.findFirst({
        where: { id: dto.documentId, companyId, recordType: SDEA_RECORD_TYPE, recordId: id },
      })
      if (!document) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message:
            'Document not found for this SDEA — upload it first via the generic documents endpoint',
        })
      }

      const updated = await tx.sdea.update({ where: { id }, data: { documentId: dto.documentId } })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'sdea_document_attached',
        recordType: SDEA_RECORD_TYPE,
        recordId: id,
        newValue: { documentId: dto.documentId },
        ip: meta.ip,
      })

      return updated
    })
  }

  async activate(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<Sdea> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const target = await tx.sdea.findFirst({ where: { id, companyId } })
      if (!target) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'SDEA draft not found' })
      }
      if (target.status !== 'draft') {
        throw new ConflictException({
          code: 'NOT_A_DRAFT',
          message: 'Only a draft SDEA can be activated',
        })
      }
      if (!target.documentId) {
        throw new ConflictException({
          code: 'DOCUMENT_REQUIRED',
          message: 'Attach the signed SDEA document before activating this version',
        })
      }

      const previousActive = await tx.sdea.findFirst({
        where: { companyId, distributorId: target.distributorId, status: 'active' },
      })
      if (previousActive) {
        await tx.sdea.update({ where: { id: previousActive.id }, data: { status: 'superseded' } })
      }

      const activated = await tx.sdea.update({ where: { id }, data: { status: 'active' } })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'sdea_activated',
        recordType: SDEA_RECORD_TYPE,
        recordId: id,
        oldValue: previousActive ? { previousActiveVersion: previousActive.version } : undefined,
        newValue: { version: activated.version },
        ip: meta.ip,
      })

      return activated
    })
  }

  async list(actor: AuthenticatedUser, query: PaginationQueryDto): Promise<PaginatedResult<Sdea>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = { companyId }
      const [rows, total] = await Promise.all([
        tx.sdea.findMany({
          where,
          orderBy: [{ distributorId: 'asc' }, { version: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.sdea.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Sdea> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.sdea.findFirst({ where: { id, companyId } })
      if (!found) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'SDEA not found' })
      }
      return found
    })
  }

  /**
   * The "reconciliation-at-risk flag" (Final doc: "an expiring/expired
   * SDEA flags the linked reconciliation relationship as at-risk") — a
   * dedicated per-distributor status read, called by the frontend's own
   * Reconciliation distributor list rather than embedded inside
   * `DistributorService` itself, which would otherwise need a new
   * cross-module dependency on `SdeaModule` for a single derived field.
   */
  async getStatusForDistributor(
    actor: AuthenticatedUser,
    distributorId: string,
  ): Promise<{ status: 'active' | 'expiring' | 'expired' | 'missing'; sdea: Sdea | null }> {
    const companyId = requireCompany(actor)
    const EXPIRY_WARNING_DAYS = 60

    return this.rls.runAsCompany(companyId, async (tx) => {
      const active = await tx.sdea.findFirst({
        where: { companyId, distributorId, status: 'active' },
      })
      if (!active) {
        return { status: 'missing' as const, sdea: null }
      }
      if (active.expiryDate) {
        const now = new Date()
        if (active.expiryDate < now) {
          return { status: 'expired' as const, sdea: active }
        }
        const warningCutoff = new Date()
        warningCutoff.setDate(warningCutoff.getDate() + EXPIRY_WARNING_DAYS)
        if (active.expiryDate < warningCutoff) {
          return { status: 'expiring' as const, sdea: active }
        }
      }
      return { status: 'active' as const, sdea: active }
    })
  }
}
