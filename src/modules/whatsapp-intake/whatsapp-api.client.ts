import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { EnvConfig } from '../../config/env.validation'

export interface DownloadedMedia {
  buffer: Buffer
  mimeType: string
}

/**
 * A thin wrapper around the WhatsApp Cloud API (Meta Graph API) — no SDK
 * dependency, just `fetch` (already IPv4-forced globally, see
 * `force-ipv4-fetch.ts`). Sending a reply is best-effort: a failed send
 * is logged, never thrown, matching `MailService`'s "the state change
 * already happened, don't fail the request over a delivery hiccup" rule
 * — the conversation state is already saved by the time a reply is sent,
 * so the reporter's next message still resumes correctly even if this
 * particular reply never arrived.
 */
@Injectable()
export class WhatsAppApiClient {
  private readonly logger = new Logger(WhatsAppApiClient.name)

  constructor(private readonly configService: ConfigService<EnvConfig, true>) {}

  async sendText(phoneNumberId: string, to: string, body: string): Promise<void> {
    const accessToken = this.requireAccessToken()
    try {
      const response = await fetch(`${this.baseUrl()}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
      })
      if (!response.ok) {
        this.logger.error(
          `WhatsApp send to ${to} failed: ${response.status} ${await response.text()}`,
        )
      }
    } catch (error) {
      this.logger.error(
        `WhatsApp send to ${to} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /** Resolves a media ID to its bytes via the Graph API's two-step handshake (ID → short-lived URL → the actual file, both bearer-authenticated). Returns null on any failure — the caller treats a photo that couldn't be fetched the same as no photo at all, rather than failing the whole conversation. */
  async downloadMedia(mediaId: string): Promise<DownloadedMedia | null> {
    const accessToken = this.requireAccessToken()
    try {
      const metaResponse = await fetch(`${this.baseUrl()}/${mediaId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!metaResponse.ok) return null
      const meta = (await metaResponse.json()) as { url?: string; mime_type?: string }
      if (!meta.url) return null

      const fileResponse = await fetch(meta.url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!fileResponse.ok) return null

      const buffer = Buffer.from(await fileResponse.arrayBuffer())
      return { buffer, mimeType: meta.mime_type ?? 'application/octet-stream' }
    } catch (error) {
      this.logger.error(
        `WhatsApp media download for ${mediaId} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      return null
    }
  }

  private baseUrl(): string {
    const version = this.configService.get('WHATSAPP_API_VERSION', { infer: true })
    return `https://graph.facebook.com/${version}`
  }

  private requireAccessToken(): string {
    const token = this.configService.get('WHATSAPP_ACCESS_TOKEN', { infer: true })
    if (!token) {
      throw new ServiceUnavailableException({
        code: 'WHATSAPP_NOT_CONFIGURED',
        message: 'WhatsApp intake is not configured on this server yet — see vg-stage3-setup.md',
      })
    }
    return token
  }
}
