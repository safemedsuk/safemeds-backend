import { Module } from '@nestjs/common'

import { DocumentsModule } from '../documents/documents.module'
import { PvModule } from '../pv/pv.module'
import { WhatsAppApiClient } from './whatsapp-api.client'
import { WhatsAppChatbotService } from './whatsapp-chatbot.service'
import { WhatsAppConversationStateService } from './whatsapp-conversation-state.service'
import { WhatsAppIntakeController } from './whatsapp-intake.controller'
import { WhatsAppIntakeService } from './whatsapp-intake.service'

@Module({
  imports: [PvModule, DocumentsModule],
  controllers: [WhatsAppIntakeController],
  providers: [
    WhatsAppIntakeService,
    WhatsAppChatbotService,
    WhatsAppConversationStateService,
    WhatsAppApiClient,
  ],
})
export class WhatsAppIntakeModule {}
