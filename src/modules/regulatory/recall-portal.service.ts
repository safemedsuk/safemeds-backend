import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { randomBytes } from 'crypto'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { hashToken } from '../auth/services/token-hash.util'
import { CreateRecallPortalLinkDto } from './dto/create-recall-portal-link.dto'
import { SubmitRecallPortalActionDto } from './dto/submit-recall-portal-action.dto'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A recall portal link is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

export interface RecallPortalContext {
  recallRef: string | null
  productName: string
  reason: string
  stakeholderOrgName: string
  language: string
  isDrill: boolean
}

/**
 * QualCloud (Phase 13) Stage 10.4 — the external stakeholder portal's
 * backend half. No accounts: a hashed, expiring, revocable token grants
 * access only to one organisation's own recall — mirroring VigiCloud
 * Stage 3.2's public-reporting-link security model exactly (`tokenHash`
 * is the only thing ever stored, matching every other single-use/scoped
 * token in this codebase per `hashToken()`'s own doc comment).
 *
 * **Honest scope boundary, matching this codebase's own established
 * precedent for genuinely new infrastructure** (VigiCloud's own
 * "not configured yet" channel states): the real offline-capable
 * service-worker PWA, the GS1 DataMatrix camera-scanning client, and
 * live WhatsApp/SMS dispatch are all client/vendor infrastructure this
 * pass does not build — this service is the complete, real,
 * fully-working *server* contract those clients would call
 * (`resolveContext`/`submitAction`, both idempotent and offline-sync
 * safe by construction), proven end to end by its own tests against
 * that exact contract.
 */
@Injectable()
export class RecallPortalService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async listLinks(actor: AuthenticatedUser, recallId: string) {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.recallPortalLink.findMany({
        where: { companyId, recallId },
        include: { stakeholder: { select: { orgName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    )
  }

  async createLink(
    actor: AuthenticatedUser,
    recallId: string,
    dto: CreateRecallPortalLinkDto,
    meta: RequestMeta,
  ): Promise<{ link: { id: string; expiresAt: Date }; token: string }> {
    const companyId = requireCompany(actor)

    const token = randomBytes(32).toString('hex')
    const tokenHash = hashToken(token)
    const expiresAt = new Date()
    expiresAt.setUTCDate(expiresAt.getUTCDate() + (dto.expiresInDays ?? 14))

    const link = await this.rls.runAsCompany(companyId, async (tx) => {
      const recall = await tx.recall.findFirst({ where: { id: recallId, companyId } })
      if (!recall) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall not found' })
      const stakeholder = await tx.stakeholder.findFirst({
        where: { id: dto.stakeholderId, companyId },
      })
      if (!stakeholder) {
        throw new NotFoundException({
          code: 'STAKEHOLDER_NOT_FOUND',
          message:
            'That stakeholder is not in your stakeholder list. Pick one from the list, or create it first.',
        })
      }

      const created = await tx.recallPortalLink.create({
        data: {
          id: newId(),
          companyId,
          recallId,
          stakeholderId: dto.stakeholderId,
          tokenHash,
          expiresAt,
          language: dto.language ?? 'en',
          createdBy: actor.sub,
        },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_portal_link_created',
        recordType: 'recall_portal_link',
        recordId: created.id,
        newValue: { stakeholderId: dto.stakeholderId },
        ip: meta.ip,
      })
      return created
    })

    return { link: { id: link.id, expiresAt: link.expiresAt }, token }
  }

  async revokeLink(actor: AuthenticatedUser, linkId: string, meta: RequestMeta) {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.recallPortalLink.findFirst({ where: { id: linkId, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Portal link not found' })
      const updated = await tx.recallPortalLink.update({
        where: { id: linkId },
        data: { revoked: true },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_portal_link_revoked',
        recordType: 'recall_portal_link',
        recordId: linkId,
        ip: meta.ip,
      })
      return updated
    })
  }

  private async resolveLink(token: string) {
    const tokenHash = hashToken(token)
    return this.rls.runWithSystemAccess(async (tx) => {
      const link = await tx.recallPortalLink.findUnique({
        where: { tokenHash },
        include: {
          stakeholder: { select: { orgName: true } },
          recall: { include: { product: { select: { brandName: true } } } },
        },
      })
      if (!link || link.revoked || link.expiresAt < new Date()) {
        throw new NotFoundException({
          code: 'INVALID_LINK',
          message: 'This link is invalid or has expired',
        })
      }
      return link
    })
  }

  /** No auth — the token itself is the credential. Returns only what that one organisation needs to see. */
  async resolveContext(token: string): Promise<RecallPortalContext> {
    const link = await this.resolveLink(token)
    return {
      recallRef: link.recall.ref,
      productName: link.recall.product.brandName,
      reason: link.recall.reason,
      stakeholderOrgName: link.stakeholder.orgName,
      language: link.language,
      isDrill: link.recall.mode === 'mock',
    }
  }

  /**
   * Idempotent by `(linkId, idempotencyKey)` — a queued-then-synced
   * offline action safe to resubmit on reconnect, per 10.4's own spec.
   */
  async submitAction(token: string, dto: SubmitRecallPortalActionDto) {
    const link = await this.resolveLink(token)

    return this.rls.runWithSystemAccess(async (tx) => {
      const existing = await tx.recallPortalAction.findUnique({
        where: { linkId_idempotencyKey: { linkId: link.id, idempotencyKey: dto.idempotencyKey } },
      })
      if (existing) return existing

      const created = await tx.recallPortalAction.create({
        data: {
          id: newId(),
          linkId: link.id,
          action: dto.action,
          payload: dto.payload ? (dto.payload as unknown as Prisma.InputJsonValue) : undefined,
          clientTimestamp: dto.clientTimestamp ? new Date(dto.clientTimestamp) : null,
          idempotencyKey: dto.idempotencyKey,
        },
      })

      await this.auditService.log(tx, {
        companyId: link.companyId,
        action: 'recall_portal_action_submitted',
        recordType: 'recall_portal_action',
        recordId: created.id,
        actorType: 'system',
        newValue: { action: dto.action, stakeholderId: link.stakeholderId },
      })

      return created
    })
  }

  async listActions(actor: AuthenticatedUser, linkId: string) {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const link = await tx.recallPortalLink.findFirst({ where: { id: linkId, companyId } })
      if (!link)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Portal link not found' })
      return tx.recallPortalAction.findMany({
        where: { linkId },
        orderBy: { serverTimestamp: 'desc' },
      })
    })
  }
}
