import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { Request, Response } from 'express'

import { Public } from '../../common/decorators/public.decorator'
import { verifyMetaSignature } from '../../common/webhooks/meta-signature.util'
import { EnvConfig } from '../../config/env.validation'
import { MetaWhatsAppWebhookPayload } from './dto/whatsapp-webhook.dto'
import { WhatsAppIntakeService } from './whatsapp-intake.service'

/**
 * VigiCloud Stage 3.4 — the WhatsApp Cloud API's two required
 * endpoints: a one-time `GET` handshake Meta calls when the webhook URL
 * is first registered (must echo back `hub.challenge` verbatim, bypasses
 * the app's normal `{ data }` envelope via `@Res()` for exactly that
 * reason), and the actual `POST` message webhook. See
 * `vg-stage3-setup.md` for how to point a real WhatsApp Business
 * Platform app at this pair.
 */
@ApiTags('whatsapp-intake')
@Controller('webhooks/whatsapp')
export class WhatsAppIntakeController {
  constructor(
    private readonly whatsAppIntakeService: WhatsAppIntakeService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  @Public()
  @Get()
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ): void {
    const expectedToken = this.configService.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN', { infer: true })
    if (!expectedToken) {
      res
        .status(503)
        .send('WhatsApp intake is not configured on this server yet — see vg-stage3-setup.md')
      return
    }

    if (mode === 'subscribe' && token === expectedToken && challenge) {
      res.status(200).send(challenge)
      return
    }

    res.status(403).send('Verification failed')
  }

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post()
  async receive(
    @Body() body: MetaWhatsAppWebhookPayload,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
  ) {
    const appSecret = this.configService.get('WHATSAPP_APP_SECRET', { infer: true })
    if (!appSecret) {
      throw new ServiceUnavailableException({
        code: 'WHATSAPP_NOT_CONFIGURED',
        message: 'WhatsApp intake is not configured on this server yet — see vg-stage3-setup.md',
      })
    }

    if (!req.rawBody || !verifyMetaSignature(req.rawBody, signature, appSecret)) {
      throw new BadRequestException({
        code: 'INVALID_SIGNATURE',
        message: 'Webhook signature verification failed',
      })
    }

    await this.whatsAppIntakeService.processWebhook(body)
    return { received: true }
  }
}
