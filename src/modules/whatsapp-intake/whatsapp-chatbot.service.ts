import { Injectable, Logger } from '@nestjs/common'

import { RlsService } from '../../common/rls/rls.service'
import { DocumentsService } from '../documents/documents.service'
import { resolveDefaultReportType } from '../pv/default-report-type.util'
import { CreatePvCaseDto } from '../pv/dto/create-pv-case.dto'
import { PvCaseService } from '../pv/pv-case.service'
import { SourceDocumentService } from '../pv/source-document.service'
import { InboundWhatsAppMessage } from './dto/whatsapp-webhook.dto'
import { WhatsAppApiClient } from './whatsapp-api.client'
import {
  ConversationState,
  WhatsAppConversationStateService,
} from './whatsapp-conversation-state.service'

const GREETING =
  "Hello, and thank you for contacting us about a possible product safety issue. I'll ask you a few quick questions. What is your name?"
const ASK_PRODUCT = 'Thank you. What is the name of the product or medicine involved?'
const ASK_EVENT = 'What happened? Please describe the reaction or problem you experienced.'
const ASK_PHOTO = (referenceNumber: string) =>
  `Thank you — your report has been recorded (reference ${referenceNumber}). If you have a photo of the product packaging, you can send it now, or reply "done" to finish.`
const CLOSING_WITH_PHOTO =
  'Photo received, thank you. Your report is complete — our safety team will review it.'
const CLOSING_NO_PHOTO = 'Your report is complete — our safety team will review it. Thank you.'
const NEED_NAME = 'Please reply with your name to continue.'
const NEED_PRODUCT = 'Please reply with the name of the product or medicine involved.'
const NEED_EVENT = 'Please describe what happened.'

/**
 * VigiCloud Stage 3.4 — the scripted (not free-form AI) WhatsApp chatbot
 * flow: name → product → event → optional packaging photo, exactly the
 * field list the todo doc specifies. Tenant routing is resolved once,
 * by `WhatsAppIntakeService`, before this class ever runs — matching
 * every other Stage 3 channel's "resolve the company, then hand off"
 * shape. The case is created as soon as name/product/event are known
 * (entering `awaiting_photo`), not deferred until the conversation
 * fully ends — a `SourceDocument` can only ever link to an existing
 * `Case`, and a reporter who never replies again (abandons after the
 * photo prompt) still leaves behind a real, triageable draft case
 * rather than losing everything they already provided.
 */
@Injectable()
export class WhatsAppChatbotService {
  private readonly logger = new Logger(WhatsAppChatbotService.name)

  constructor(
    private readonly rls: RlsService,
    private readonly stateService: WhatsAppConversationStateService,
    private readonly apiClient: WhatsAppApiClient,
    private readonly pvCaseService: PvCaseService,
    private readonly documentsService: DocumentsService,
    private readonly sourceDocumentService: SourceDocumentService,
  ) {}

  async handleMessage(message: InboundWhatsAppMessage): Promise<void> {
    const company = await this.rls.runWithSystemAccess((tx) =>
      tx.company.findFirst({
        where: { whatsappBusinessPhoneNumberId: message.phoneNumberId, status: 'active' },
      }),
    )
    if (!company) {
      this.logger.warn(
        `WhatsApp message addressed to an unrecognized phone_number_id: ${message.phoneNumberId}`,
      )
      return
    }

    const { phoneNumberId, from: waId } = message
    const existing = await this.stateService.get(phoneNumberId, waId)

    if (!existing) {
      await this.stateService.set(phoneNumberId, waId, {
        step: 'awaiting_name',
        companyId: company.id,
      })
      await this.apiClient.sendText(phoneNumberId, waId, GREETING)
      return
    }

    switch (existing.step) {
      case 'awaiting_name':
        return this.handleAwaitingName(existing, message)
      case 'awaiting_product':
        return this.handleAwaitingProduct(existing, message)
      case 'awaiting_event':
        return this.handleAwaitingEvent(existing, message, company.id)
      case 'awaiting_photo':
        return this.handleAwaitingPhoto(existing, message, company.id)
    }
  }

  private async handleAwaitingName(
    state: ConversationState,
    message: InboundWhatsAppMessage,
  ): Promise<void> {
    const name = message.text?.trim()
    if (!name) {
      await this.apiClient.sendText(message.phoneNumberId, message.from, NEED_NAME)
      return
    }
    await this.stateService.set(message.phoneNumberId, message.from, {
      ...state,
      step: 'awaiting_product',
      reporterName: name,
    })
    await this.apiClient.sendText(message.phoneNumberId, message.from, ASK_PRODUCT)
  }

  private async handleAwaitingProduct(
    state: ConversationState,
    message: InboundWhatsAppMessage,
  ): Promise<void> {
    const product = message.text?.trim()
    if (!product) {
      await this.apiClient.sendText(message.phoneNumberId, message.from, NEED_PRODUCT)
      return
    }
    await this.stateService.set(message.phoneNumberId, message.from, {
      ...state,
      step: 'awaiting_event',
      productName: product,
    })
    await this.apiClient.sendText(message.phoneNumberId, message.from, ASK_EVENT)
  }

  private async handleAwaitingEvent(
    state: ConversationState,
    message: InboundWhatsAppMessage,
    companyId: string,
  ): Promise<void> {
    const event = message.text?.trim()
    if (!event) {
      await this.apiClient.sendText(message.phoneNumberId, message.from, NEED_EVENT)
      return
    }

    const referenceNumber = await this.createCase(companyId, state, message, event)
    if (!referenceNumber) {
      // No PV report type configured for this tenant — nothing sensible to
      // do but tell the reporter, and leave the conversation state as-is
      // so a retry (once configured) can pick back up from here.
      await this.apiClient.sendText(
        message.phoneNumberId,
        message.from,
        "We're unable to accept reports through this channel right now — please contact us another way.",
      )
      return
    }

    await this.stateService.set(message.phoneNumberId, message.from, {
      ...state,
      step: 'awaiting_photo',
      eventNarrative: event,
      caseId: referenceNumber.caseId,
      caseReferenceNumber: referenceNumber.referenceNumber,
    })
    await this.apiClient.sendText(
      message.phoneNumberId,
      message.from,
      ASK_PHOTO(referenceNumber.referenceNumber),
    )
  }

  private async handleAwaitingPhoto(
    state: ConversationState,
    message: InboundWhatsAppMessage,
    companyId: string,
  ): Promise<void> {
    if (message.imageId && state.caseId) {
      const attached = await this.attachPhoto(companyId, state.caseId, message.imageId)
      await this.apiClient.sendText(
        message.phoneNumberId,
        message.from,
        attached
          ? CLOSING_WITH_PHOTO
          : "We couldn't retrieve that photo, but your report is already complete. Thank you.",
      )
      await this.stateService.clear(message.phoneNumberId, message.from)
      return
    }

    // Any non-photo reply here ("done", "skip", or anything else) ends the
    // conversation — the case already exists regardless.
    await this.stateService.clear(message.phoneNumberId, message.from)
    await this.apiClient.sendText(message.phoneNumberId, message.from, CLOSING_NO_PHOTO)
  }

  private async createCase(
    companyId: string,
    state: ConversationState,
    message: InboundWhatsAppMessage,
    eventNarrative: string,
  ): Promise<{ caseId: string; referenceNumber: string } | null> {
    const reportType = await this.rls.runWithSystemAccess((tx) => resolveDefaultReportType(tx))
    const company = await this.rls.runWithSystemAccess((tx) =>
      tx.company.findFirstOrThrow({ where: { id: companyId } }),
    )
    if (!reportType) {
      this.logger.error(
        `No PV report type configured — cannot create a WhatsApp-sourced case for company ${companyId}`,
      )
      return null
    }

    const today = new Date().toISOString().slice(0, 10)
    const dto: CreatePvCaseDto = {
      reportTypeId: reportType.id,
      countryOfOccurrenceId: company.homeCountryId,
      countryOfReportId: company.homeCountryId,
      awarenessDate: today,
      receivedDate: today,
      additionalInformation: `Received via WhatsApp — reporter WhatsApp ID: ${message.from}`,
      reporter: {
        reporterType: 'consumer',
        fullName: state.reporterName ?? message.profileName ?? message.from,
        phone: message.from,
      },
      patient: {},
      suspectProducts: [
        { drugCharacterization: 'suspect', medicinalProduct: state.productName as string },
      ],
      adverseEvents: [{ reportedTerm: eventNarrative, narrative: eventNarrative }],
    }

    const created = await this.pvCaseService.createFromSystemChannel(
      companyId,
      dto,
      'whatsapp_qr',
      message.from,
      {},
    )
    return { caseId: created.id, referenceNumber: created.referenceNumber }
  }

  private async attachPhoto(companyId: string, caseId: string, imageId: string): Promise<boolean> {
    const media = await this.apiClient.downloadMedia(imageId)
    if (!media) return false

    const extension = media.mimeType.split('/')[1] ?? 'jpg'
    const { document } = await this.documentsService.uploadDirectSystem(
      companyId,
      'pv_case',
      caseId,
      {
        buffer: media.buffer,
        originalname: `whatsapp-packaging-photo.${extension}`,
        mimetype: media.mimeType,
      },
      { title: 'Packaging photo (via WhatsApp)' },
      {},
    )
    await this.sourceDocumentService.linkSystem(companyId, caseId, document.id, {})
    return true
  }
}
