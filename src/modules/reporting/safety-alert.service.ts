import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { SafetyAlert, SafetyAlertStatus } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CreateSafetyAlertDto } from './dto/create-safety-alert.dto'
import { UpdateSafetyAlertStatusDto } from './dto/update-safety-alert-status.dto'

export interface RequestMeta {
  ip?: string
}

export const SAFETY_ALERT_RECORD_TYPE = 'safety_alert'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A safety alert is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * VigiCloud Stage 18 — the manual, audit-trailed half of "safety-signal
 * notifications." See `SafetyAlert`'s own schema doc comment for why the
 * daily external-source scan is deliberately not built here. A human logs
 * what they found; `status` is a simple linear log (open → reviewed →
 * actioned/dismissed), not a full workflow-engine instance — there's no
 * role-gated multi-actor handoff to model, just one QPPV deciding what
 * to do with a signal they read about.
 */
@Injectable()
export class SafetyAlertService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    dto: CreateSafetyAlertDto,
    meta: RequestMeta,
  ): Promise<SafetyAlert> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      if (dto.affectedProductId) {
        const product = await tx.product.findFirst({
          where: { id: dto.affectedProductId, companyId },
        })
        if (!product) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' })
        }
      }

      const created = await tx.safetyAlert.create({
        data: {
          id: newId(),
          companyId,
          title: dto.title,
          source: dto.source,
          sourceUrl: dto.sourceUrl ?? null,
          summary: dto.summary,
          affectedProductId: dto.affectedProductId ?? null,
          loggedBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'safety_alert_logged',
        recordType: SAFETY_ALERT_RECORD_TYPE,
        recordId: created.id,
        newValue: { title: created.title, source: created.source },
        ip: meta.ip,
      })

      return created
    })
  }

  async updateStatus(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateSafetyAlertStatusDto,
    meta: RequestMeta,
  ): Promise<SafetyAlert> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.safetyAlert.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Safety alert not found' })
      }

      const updated = await tx.safetyAlert.update({
        where: { id },
        data: { status: dto.status, reviewNote: dto.reviewNote ?? existing.reviewNote },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'safety_alert_status_updated',
        recordType: SAFETY_ALERT_RECORD_TYPE,
        recordId: id,
        oldValue: { status: existing.status },
        newValue: { status: updated.status },
        ip: meta.ip,
      })

      return updated
    })
  }

  async list(actor: AuthenticatedUser, status?: SafetyAlertStatus): Promise<SafetyAlert[]> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      return tx.safetyAlert.findMany({
        where: { companyId, ...(status ? { status } : {}) },
        orderBy: { createdAt: 'desc' },
      })
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<SafetyAlert> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const alert = await tx.safetyAlert.findFirst({ where: { id, companyId } })
      if (!alert) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Safety alert not found' })
      }
      return alert
    })
  }

  /** Alerts still awaiting a decision — used by `DashboardService`. */
  async countOpen(companyId: string): Promise<number> {
    return this.rls.runAsCompany(companyId, async (tx) => {
      return tx.safetyAlert.count({ where: { companyId, status: 'open' } })
    })
  }
}
