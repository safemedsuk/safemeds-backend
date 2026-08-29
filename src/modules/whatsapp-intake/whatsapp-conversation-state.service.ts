import { Injectable } from '@nestjs/common'

import { RedisService } from '../../common/redis/redis.service'

export type ConversationStep =
  'awaiting_name' | 'awaiting_product' | 'awaiting_event' | 'awaiting_photo'

export interface ConversationState {
  step: ConversationStep
  companyId: string
  reporterName?: string
  productName?: string
  eventNarrative?: string
  /** Set once the case exists (entering `awaiting_photo`) — the target for an optional packaging-photo `SourceDocument` attachment. */
  caseId?: string
  caseReferenceNumber?: string
}

const KEY_PREFIX = 'whatsapp:convo:'
/** A reporter has a day to finish the conversation before it resets — long enough to survive putting the phone down mid-reply, short enough not to accumulate abandoned state forever. */
const TTL_SECONDS = 24 * 60 * 60

/**
 * VigiCloud Stage 3.4 — per-conversation state for the scripted WhatsApp
 * chatbot flow, keyed by `(phoneNumberId, waId)` so the same reporter
 * texting two different tenants' WhatsApp numbers gets two independent
 * conversations. Redis, TTL-based — matches the existing
 * `MfaPendingTokenService` pattern for ephemeral, non-audited flow state
 * that doesn't belong in Postgres.
 */
@Injectable()
export class WhatsAppConversationStateService {
  constructor(private readonly redisService: RedisService) {}

  async get(phoneNumberId: string, waId: string): Promise<ConversationState | null> {
    const raw = await this.redisService.client.get(this.key(phoneNumberId, waId))
    return raw ? (JSON.parse(raw) as ConversationState) : null
  }

  async set(phoneNumberId: string, waId: string, state: ConversationState): Promise<void> {
    await this.redisService.client.set(
      this.key(phoneNumberId, waId),
      JSON.stringify(state),
      'EX',
      TTL_SECONDS,
    )
  }

  async clear(phoneNumberId: string, waId: string): Promise<void> {
    await this.redisService.client.del(this.key(phoneNumberId, waId))
  }

  private key(phoneNumberId: string, waId: string): string {
    return `${KEY_PREFIX}${phoneNumberId}:${waId}`
  }
}
