import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  RawBodyRequest,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { Request } from 'express'

import { Public } from '../../common/decorators/public.decorator'
import { verifySvixSignature } from '../../common/webhooks/svix-signature.util'
import { EnvConfig } from '../../config/env.validation'
import { InboundEmailWebhookPayload } from './dto/inbound-email-webhook.dto'
import { EmailIntakeService } from './email-intake.service'

/**
 * VigiCloud Stage 3.3 — Resend's inbound-email webhook target. See
 * `vg-stage3-setup.md` for how to point a real drug-safety mailbox at
 * this endpoint. `RESEND_INBOUND_WEBHOOK_SECRET` unset means the
 * feature simply isn't provisioned yet — a clear 503, not a silent
 * no-op or a 500, since a vendor genuinely retrying this webhook needs
 * an honest signal either way.
 */
@ApiTags('email-intake')
@Controller('webhooks/inbound-email')
export class EmailIntakeController {
  constructor(
    private readonly emailIntakeService: EmailIntakeService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post()
  async receive(
    @Body() body: InboundEmailWebhookPayload,
    @Req() req: RawBodyRequest<Request>,
    @Headers('svix-id') svixId: string | undefined,
    @Headers('svix-timestamp') svixTimestamp: string | undefined,
    @Headers('svix-signature') svixSignature: string | undefined,
  ) {
    const secret = this.configService.get('RESEND_INBOUND_WEBHOOK_SECRET', { infer: true })
    if (!secret) {
      throw new ServiceUnavailableException({
        code: 'EMAIL_INTAKE_NOT_CONFIGURED',
        message:
          'Inbound email ingestion is not configured on this server yet — see vg-stage3-setup.md',
      })
    }

    if (!svixId || !svixTimestamp || !svixSignature || !req.rawBody) {
      throw new BadRequestException({
        code: 'MISSING_SIGNATURE',
        message: 'Missing webhook signature headers',
      })
    }

    const verified = verifySvixSignature(
      req.rawBody,
      { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
      secret,
    )
    if (!verified) {
      throw new BadRequestException({
        code: 'INVALID_SIGNATURE',
        message: 'Webhook signature verification failed',
      })
    }

    return this.emailIntakeService.processInboundEmail(body, { ip: req.ip })
  }
}
