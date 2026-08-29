import { Injectable, Logger } from '@nestjs/common'

import { extractInboundMessages, MetaWhatsAppWebhookPayload } from './dto/whatsapp-webhook.dto'
import { WhatsAppChatbotService } from './whatsapp-chatbot.service'

/**
 * VigiCloud Stage 3.4 — flattens a Meta webhook call (which can batch
 * messages from several conversations) and hands each one to
 * `WhatsAppChatbotService` in sequence, not in parallel — two messages
 * from the *same* conversation arriving in one batch must be applied in
 * order against the same Redis-backed state, so processing them
 * concurrently would race. Each message is handled inside its own
 * try/catch: Meta expects a fast 200 regardless, and one malformed or
 * failing message must never take the rest of the batch down with it.
 */
@Injectable()
export class WhatsAppIntakeService {
  private readonly logger = new Logger(WhatsAppIntakeService.name)

  constructor(private readonly chatbotService: WhatsAppChatbotService) {}

  async processWebhook(payload: MetaWhatsAppWebhookPayload): Promise<void> {
    const messages = extractInboundMessages(payload)

    for (const message of messages) {
      try {
        await this.chatbotService.handleMessage(message)
      } catch (error) {
        this.logger.error(
          `Failed to handle WhatsApp message from ${message.from}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }
}
