/**
 * The WhatsApp Cloud API's webhook envelope (Meta Graph API's standard
 * `entry[].changes[].value` shape). Deliberately a **plain interface,
 * not a class-validator DTO** — same reasoning as
 * `InboundEmailWebhookPayload`: the app's global `ValidationPipe` runs
 * `whitelist: true, forbidNonWhitelisted: true`, which would strip or
 * reject fields on a payload this codebase doesn't own the shape of.
 * `WhatsAppIntakeService` does its own lenient parsing of only the
 * fields it needs.
 */
export interface MetaWhatsAppWebhookPayload {
  object?: string
  entry?: Array<{
    id?: string
    changes?: Array<{
      field?: string
      value?: {
        messaging_product?: string
        metadata?: { display_phone_number?: string; phone_number_id?: string }
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>
        messages?: Array<{
          from?: string
          id?: string
          timestamp?: string
          type?: string
          text?: { body?: string }
          image?: { id?: string; mime_type?: string; sha256?: string; caption?: string }
        }>
      }
    }>
  }>
}

/** One inbound message, flattened out of the nested webhook envelope for `WhatsAppChatbotService` to act on. */
export interface InboundWhatsAppMessage {
  phoneNumberId: string
  /** The reporter's WhatsApp ID (their phone number) — used as the conversation-state key and the reply target. */
  from: string
  profileName?: string
  text?: string
  imageId?: string
}

/** Walks the full webhook envelope and flattens every `messages[]` entry across every `entry`/`changes` pair into a simple list — a single webhook call can batch messages from multiple conversations. */
export function extractInboundMessages(
  payload: MetaWhatsAppWebhookPayload,
): InboundWhatsAppMessage[] {
  const messages: InboundWhatsAppMessage[] = []

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue
      const value = change.value
      const phoneNumberId = value?.metadata?.phone_number_id
      if (!phoneNumberId) continue

      const profileName = value?.contacts?.[0]?.profile?.name

      for (const message of value?.messages ?? []) {
        if (!message.from) continue
        messages.push({
          phoneNumberId,
          from: message.from,
          profileName,
          text: message.text?.body,
          imageId: message.image?.id,
        })
      }
    }
  }

  return messages
}
