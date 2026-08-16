import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Capa } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult, PaginationQueryDto } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CreateCapaDto } from './dto/create-capa.dto'
import { RecordCapaEffectivenessDto } from './dto/record-capa-effectiveness.dto'
import { UpdateCapaDto } from './dto/update-capa.dto'

export interface RequestMeta {
  ip?: string
}

export const CAPA_RECORD_TYPE = 'capa'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'CAPAs are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * VigiCloud Stage 16.3 — "a CAPA isn't closeable until its effectiveness
 * is separately confirmed, not just marked done" (this stage's own
 * build-spec text). `recordEffectivenessCheck()` and `close()` are two
 * deliberately separate steps — the same two-step shape
 * `ExpectednessService`/`CodingService` already established for
 * "assess, then the assessment becomes usable elsewhere" — reusing the
 * existing `quality.close_capa` permission (seeded since Phase 2, never
 * wired to a real endpoint until now) for both, since both are the
 * "closing" side of the workflow `quality.log_deviation`/
 * `quality.manage_capa` (opening/logging) don't cover.
 */
@Injectable()
export class CapaService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateCapaDto, meta: RequestMeta): Promise<Capa> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      if (dto.findingId) {
        const finding = await tx.auditFinding.findFirst({ where: { id: dto.findingId, companyId } })
        if (!finding) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Audit finding not found' })
        }
      }

      const created = await tx.capa.create({
        data: {
          id: newId(),
          companyId,
          findingId: dto.findingId ?? null,
          title: dto.title,
          correctiveAction: dto.correctiveAction,
          preventiveAction: dto.preventiveAction ?? null,
          ownerUserId: dto.ownerUserId ?? null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        },
      })

      if (dto.findingId) {
        await tx.auditFinding.update({
          where: { id: dto.findingId },
          data: { status: 'capa_assigned' },
        })
      }

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'capa_opened',
        recordType: CAPA_RECORD_TYPE,
        recordId: created.id,
        newValue: { title: created.title, findingId: created.findingId },
        ip: meta.ip,
      })

      return created
    })
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateCapaDto,
    meta: RequestMeta,
  ): Promise<Capa> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.capa.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'CAPA not found' })
      }
      if (existing.status === 'closed') {
        throw new ConflictException({
          code: 'ALREADY_CLOSED',
          message: 'A closed CAPA cannot be edited',
        })
      }

      const updated = await tx.capa.update({
        where: { id },
        data: {
          correctiveAction: dto.correctiveAction,
          preventiveAction: dto.preventiveAction,
          ownerUserId: dto.ownerUserId,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          status: dto.status,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'capa_updated',
        recordType: CAPA_RECORD_TYPE,
        recordId: id,
        oldValue: { status: existing.status },
        newValue: dto as Record<string, unknown>,
        ip: meta.ip,
      })

      return updated
    })
  }

  /** The mandatory separate step before `close()` will ever accept this CAPA. */
  async recordEffectivenessCheck(
    actor: AuthenticatedUser,
    id: string,
    dto: RecordCapaEffectivenessDto,
    meta: RequestMeta,
  ): Promise<Capa> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.capa.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'CAPA not found' })
      }
      if (existing.status === 'closed') {
        throw new ConflictException({
          code: 'ALREADY_CLOSED',
          message: 'A closed CAPA cannot have a new effectiveness check recorded',
        })
      }

      const updated = await tx.capa.update({
        where: { id },
        data: {
          status: 'pending_effectiveness_check',
          effectivenessCheckedAt: new Date(),
          effectivenessCheckedBy: actor.sub,
          effectivenessCheckResult: dto.result,
          effectivenessCheckNote: dto.note ?? null,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'capa_effectiveness_checked',
        recordType: CAPA_RECORD_TYPE,
        recordId: id,
        newValue: { result: dto.result },
        ip: meta.ip,
      })

      return updated
    })
  }

  async close(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<Capa> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.capa.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'CAPA not found' })
      }
      if (existing.status === 'closed') {
        throw new ConflictException({
          code: 'ALREADY_CLOSED',
          message: 'This CAPA is already closed',
        })
      }
      if (!existing.effectivenessCheckResult) {
        throw new ConflictException({
          code: 'EFFECTIVENESS_CHECK_REQUIRED',
          message: 'Record an effectiveness check before this CAPA can be closed',
        })
      }

      const updated = await tx.capa.update({
        where: { id },
        data: { status: 'closed', closedAt: new Date() },
      })

      if (existing.findingId) {
        await tx.auditFinding.update({
          where: { id: existing.findingId },
          data: { status: 'closed' },
        })
      }

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'capa_closed',
        recordType: CAPA_RECORD_TYPE,
        recordId: id,
        newValue: { effectivenessCheckResult: existing.effectivenessCheckResult },
        ip: meta.ip,
      })

      return updated
    })
  }

  async list(actor: AuthenticatedUser, query: PaginationQueryDto): Promise<PaginatedResult<Capa>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = { companyId }
      const [rows, total] = await Promise.all([
        tx.capa.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.capa.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Capa> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.capa.findFirst({ where: { id, companyId } })
      if (!found) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'CAPA not found' })
      }
      return found
    })
  }
}
