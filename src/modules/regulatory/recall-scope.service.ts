import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { RecallScopeItem, RecallScopeVersion } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CreateRecallScopeVersionDto } from './dto/create-recall-scope-version.dto'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A recall scope version is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

export type RecallScopeVersionWithItems = RecallScopeVersion & { items: RecallScopeItem[] }

/**
 * QualCloud (Phase 13) Stage 10.2 — "the recall never duplicates master
 * data; it references it and snapshots at scope freeze" (Engineering
 * Build Package). `createDraft()` always starts a new version
 * (superseding any prior `draft`, per the same discipline
 * `RegistrationArchiveService` uses for a superseded prior document);
 * `freeze()` is the one-way action that makes a version immutable and
 * is the real gate `RecallWorkflowGuards`'
 * `under_assessment → approved` check looks for.
 */
@Injectable()
export class RecallScopeService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async list(actor: AuthenticatedUser, recallId: string): Promise<RecallScopeVersionWithItems[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.recallScopeVersion.findMany({
        where: { companyId, recallId },
        include: { items: true },
        orderBy: { version: 'desc' },
      }),
    )
  }

  async createDraft(
    actor: AuthenticatedUser,
    recallId: string,
    dto: CreateRecallScopeVersionDto,
    meta: RequestMeta,
  ): Promise<RecallScopeVersionWithItems> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const recall = await tx.recall.findFirst({ where: { id: recallId, companyId } })
      if (!recall) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall not found' })

      const maxVersion = await tx.recallScopeVersion.aggregate({
        where: { recallId },
        _max: { version: true },
      })
      // Any prior `draft` (never `frozen`/`superseded`) is superseded
      // by this new one, since only one draft at a time makes sense.
      await tx.recallScopeVersion.updateMany({
        where: { recallId, status: 'draft' },
        data: { status: 'superseded' },
      })

      const version = (maxVersion._max.version ?? 0) + 1
      const created = await tx.recallScopeVersion.create({
        data: {
          id: newId(),
          companyId,
          recallId,
          version,
          status: 'draft',
          reason: dto.reason ?? null,
          createdBy: actor.sub,
          items: {
            create: dto.items.map((item) => ({
              id: newId(),
              productId: item.productId,
              batchId: item.batchId,
              batchSize: item.batchSize ?? null,
              quantityDistributed: item.quantityDistributed ?? null,
              quantityHeldByMah: item.quantityHeldByMah ?? null,
            })),
          },
        },
        include: { items: true },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_scope_version_created',
        recordType: 'recall_scope_version',
        recordId: created.id,
        newValue: { version, itemCount: created.items.length },
        ip: meta.ip,
      })
      return created
    })
  }

  async freeze(
    actor: AuthenticatedUser,
    scopeVersionId: string,
    meta: RequestMeta,
  ): Promise<RecallScopeVersionWithItems> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.recallScopeVersion.findFirst({
        where: { id: scopeVersionId, companyId },
        include: { items: true },
      })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Scope version not found' })
      }
      if (existing.status !== 'draft') {
        throw new ConflictException({
          code: 'NOT_A_DRAFT',
          message: 'Only a draft scope version can be frozen',
        })
      }
      if (existing.items.length === 0) {
        throw new ConflictException({
          code: 'EMPTY_SCOPE',
          message: 'A scope version needs at least one product/batch before it can be frozen',
        })
      }

      const updated = await tx.recallScopeVersion.update({
        where: { id: scopeVersionId },
        data: { status: 'frozen', approvedBy: actor.sub, approvedAt: new Date() },
        include: { items: true },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_scope_version_frozen',
        recordType: 'recall_scope_version',
        recordId: scopeVersionId,
        newValue: { version: updated.version },
        ip: meta.ip,
      })
      return updated
    })
  }
}
