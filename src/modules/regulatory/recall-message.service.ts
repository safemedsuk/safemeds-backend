import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { RecallMessage } from '@prisma/client'

import { TextEncryptionService } from '../../common/encryption/text-encryption.service'
import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { SendRecallMessageDto } from './dto/send-recall-message.dto'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A recall message is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

export type RecallMessageWithDecrypted = Omit<RecallMessage, 'bodyEncrypted'> & { body: string }

/**
 * QualCloud (Phase 13) Stage 10.4 — the internal log of every
 * message/channel/delivery/read status. `bodyEncrypted` via the same
 * `TextEncryptionService` convention as every other operational
 * message log carrying real product/batch detail. Email is real and
 * live (`NotificationsService.sendExternalEmail()`); WhatsApp/SMS
 * honestly report `not_configured` until real vendor credentials
 * exist, mirroring VigiCloud Stage 3.3/3.4's own already-established
 * pattern for exactly this situation — never a fabricated "sent."
 */
@Injectable()
export class RecallMessageService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly encryption: TextEncryptionService,
  ) {}

  async list(actor: AuthenticatedUser, recallId: string): Promise<RecallMessageWithDecrypted[]> {
    const companyId = requireCompany(actor)
    const rows = await this.rls.runAsCompany(companyId, (tx) =>
      tx.recallMessage.findMany({ where: { companyId, recallId }, orderBy: { createdAt: 'desc' } }),
    )
    return rows.map((row) => this.decrypt(row))
  }

  private decrypt(row: RecallMessage): RecallMessageWithDecrypted {
    const { bodyEncrypted, ...rest } = row
    return { ...rest, body: this.encryption.decrypt(bodyEncrypted) }
  }

  async send(
    actor: AuthenticatedUser,
    recallId: string,
    dto: SendRecallMessageDto,
    meta: RequestMeta,
  ): Promise<RecallMessageWithDecrypted> {
    const companyId = requireCompany(actor)

    const created = await this.rls.runAsCompany(companyId, async (tx) => {
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

      const canSendNow = dto.channel === 'email' && !!stakeholder.contactEmail
      const row = await tx.recallMessage.create({
        data: {
          id: newId(),
          companyId,
          recallId,
          stakeholderId: dto.stakeholderId,
          channel: dto.channel,
          templateId: dto.templateId ?? null,
          bodyEncrypted: this.encryption.encrypt(dto.body),
          status: canSendNow ? 'queued' : 'not_configured',
          isDrill: recall.mode === 'mock',
          sentAt: canSendNow ? new Date() : null,
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_message_sent',
        recordType: 'recall_message',
        recordId: row.id,
        newValue: { channel: dto.channel, stakeholderId: dto.stakeholderId, status: row.status },
        ip: meta.ip,
      })

      return { row, stakeholder, canSendNow }
    })

    if (created.canSendNow && created.stakeholder.contactEmail) {
      const subject = created.row.isDrill
        ? '[DRILL] Product recall notice'
        : 'Product recall notice — action required'
      await this.notificationsService.sendExternalEmail(
        created.stakeholder.contactEmail,
        subject,
        dto.body,
      )
    }

    return this.decrypt(created.row)
  }
}
