import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { Request, Response } from 'express'

import { Public } from '../../common/decorators/public.decorator'
import { RlsService } from '../../common/rls/rls.service'
import { EnvConfig } from '../../config/env.validation'
import { SessionService } from '../auth/services/session.service'
import { finalizeSessionResponse } from '../auth/session-response.util'
import { RolesService } from '../roles/roles.service'
import { AcceptInvitationDto } from './dto/accept-invitation.dto'
import { ResendInvitationVerificationDto } from './dto/resend-invitation-verification.dto'
import { VerifyInvitationEmailDto } from './dto/verify-invitation-email.dto'
import { InvitationsService } from './invitations.service'

/**
 * `@Public` counterpart to `InvitationsController` — the invitee has no
 * account yet, so these routes live outside auth. Registered separately
 * (rather than folded into `AuthController`) to keep that controller from
 * growing further while still matching the spec's `/auth/invitations/...`
 * URL scheme exactly.
 */
@ApiTags('invitations')
@Controller('auth/invitations')
export class InvitationPublicController {
  constructor(
    private readonly invitationsService: InvitationsService,
    private readonly sessionService: SessionService,
    private readonly rolesService: RolesService,
    private readonly rls: RlsService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  @Public()
  @Get(':token')
  lookup(@Param('token') token: string) {
    return this.invitationsService.lookup(token)
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':token/accept')
  async accept(
    @Param('token') token: string,
    @Body() dto: AcceptInvitationDto,
    @Req() req: Request,
  ) {
    return this.invitationsService.accept(token, dto, { ip: req.ip })
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('verify-email')
  async verifyEmail(
    @Body() dto: VerifyInvitationEmailDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = await this.invitationsService.verifyEmail(dto.email, dto.code)
    const result = await this.sessionService.issueSessionForUser(userId, { ip: req.ip })
    return finalizeSessionResponse(result, res, this.configService, this.rls, this.rolesService)
  }

  @Public()
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  @Post('resend-code')
  async resendCode(@Body() dto: ResendInvitationVerificationDto) {
    await this.invitationsService.resendVerificationCode(dto.email)
    return { sent: true }
  }
}
