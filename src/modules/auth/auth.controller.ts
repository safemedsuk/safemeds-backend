import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  Param,
  ParseFilePipeBuilder,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { randomBytes } from 'crypto'
import type { Request, Response } from 'express'
import { memoryStorage } from 'multer'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Public } from '../../common/decorators/public.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PaginationQueryDto } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { EnvConfig } from '../../config/env.validation'
import { RolesService } from '../roles/roles.service'
import {
  clearAuthCookies,
  readRefreshTokenCookie,
  setAccessTokenCookie,
  setAuthCookies,
} from './cookie.util'
import { ChangePasswordDto } from './dto/change-password.dto'
import { ForgotPasswordDto } from './dto/forgot-password.dto'
import { LoginDto } from './dto/login.dto'
import { MfaChallengeDto } from './dto/mfa-challenge.dto'
import { MfaVerifySetupDto } from './dto/mfa-verify-setup.dto'
import { ReauthDto } from './dto/reauth.dto'
import { RegisterCompanyDto } from './dto/register-company.dto'
import { ResendCodeDto } from './dto/resend-code.dto'
import { ResetPasswordDto } from './dto/reset-password.dto'
import { VerifyEmailDto } from './dto/verify-email.dto'
import { MfaService } from './services/mfa.service'
import { MfaPendingTokenService } from './services/mfa-pending-token.service'
import { PasswordLifecycleService } from './services/password-lifecycle.service'
import { ReauthService } from './services/reauth.service'
import { RegistrationService } from './services/registration.service'
import { SessionService } from './services/session.service'
import { TokenService } from './services/token.service'
import { finalizeSessionResponse, safeUser } from './session-response.util'

function requestMeta(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.headers['user-agent'] }
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registrationService: RegistrationService,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
    private readonly reauthService: ReauthService,
    private readonly mfaService: MfaService,
    private readonly mfaPendingTokenService: MfaPendingTokenService,
    private readonly passwordLifecycleService: PasswordLifecycleService,
    private readonly rolesService: RolesService,
    private readonly rls: RlsService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  @Public()
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post('register-company')
  async registerCompany(@Body() dto: RegisterCompanyDto) {
    const registration = await this.registrationService.registerCompany(dto)
    return { referenceNumber: registration.referenceNumber, status: registration.status }
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @Post('register-company/:ref/licence')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadLicence(
    @Param('ref') ref: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File,
  ) {
    return this.registrationService.uploadLicence(ref, {
      buffer: file.buffer,
      originalname: file.originalname,
    })
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    const registration = await this.registrationService.verifyEmail(dto)
    return { status: registration.status }
  }

  @Public()
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  @Post('resend-code')
  async resendCode(@Body() dto: ResendCodeDto) {
    await this.registrationService.resendCode(dto)
    return { sent: true }
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.sessionService.login(dto, requestMeta(req))

    if (result.mfaRequired) {
      return {
        mfaRequired: true,
        mfaPendingToken: result.mfaPendingToken,
        mfaPendingExpiresInSeconds: result.mfaPendingExpiresInSeconds,
      }
    }

    return finalizeSessionResponse(result, res, this.configService, this.rls, this.rolesService)
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/challenge')
  async mfaChallenge(
    @Body() dto: MfaChallengeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // A wrong code must NOT burn the whole login session — verify() only
    // reads the pending session, it doesn't consume it, so a mistyped or
    // late-typed code can be retried instead of forcing a fresh
    // email+password login. See MfaPendingTokenService's docstring.
    const { userId, jti } = await this.mfaPendingTokenService.verify(dto.mfaPendingToken)

    try {
      await this.mfaService.challenge(userId, dto, requestMeta(req))
    } catch (err) {
      if (err instanceof UnauthorizedException || err instanceof ForbiddenException) {
        const attemptsRemaining = await this.mfaPendingTokenService.recordFailedAttempt(jti)
        const body = err.getResponse()
        const enriched =
          typeof body === 'object' && body !== null
            ? { ...body, attemptsRemaining }
            : { message: body, attemptsRemaining }
        // Same status, enriched body — AllExceptionsFilter reads any HttpException by status+getResponse(), not by subclass.
        throw new HttpException(enriched, err.getStatus())
      }
      throw err
    }

    await this.mfaPendingTokenService.consume(jti)
    const result = await this.sessionService.completeMfaLogin(userId, requestMeta(req))
    return finalizeSessionResponse(result, res, this.configService, this.rls, this.rolesService)
  }

  @Post('mfa/setup')
  async mfaSetup(@CurrentUser() user: AuthenticatedUser) {
    return this.mfaService.setup(user.sub)
  }

  @Post('mfa/verify-setup')
  async mfaVerifySetup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MfaVerifySetupDto,
    @Req() req: Request,
  ) {
    return this.mfaService.verifySetup(user.sub, dto, requestMeta(req))
  }

  @Post('mfa/disable')
  async mfaDisable(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReauthDto,
    @Req() req: Request,
  ) {
    await this.mfaService.disable(user.sub, dto, requestMeta(req))
    return { disabled: true }
  }

  @Post('mfa/recovery-codes/regenerate')
  async mfaRegenerateRecoveryCodes(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReauthDto,
    @Req() req: Request,
  ) {
    return this.mfaService.regenerateRecoveryCodes(user.sub, dto, requestMeta(req))
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshCookie = readRefreshTokenCookie(req)
    if (!refreshCookie) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'No refresh token present',
      })
    }

    const result = await this.sessionService.refresh(refreshCookie, requestMeta(req))
    const csrfToken = randomBytes(32).toString('hex')

    setAuthCookies(res, this.configService, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken.plaintext,
      csrfToken,
      refreshExpiresAt: result.refreshToken.expiresAt,
    })

    const permissions = await this.rolesService.getPermissionsForUser({
      sub: result.user.id,
      companyId: result.user.companyId,
      roleKeys: result.user.roleKeys,
      platformRole: result.user.platformRole,
      tokenVersion: result.user.tokenVersion,
    })

    return { user: safeUser(result.user, undefined, Array.from(permissions)) }
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshCookie = readRefreshTokenCookie(req)
    if (refreshCookie) {
      await this.sessionService.logout(refreshCookie)
    }
    clearAuthCookies(res, this.configService)
    return { loggedOut: true }
  }

  @Get('sessions')
  async listSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
    @Req() req: Request,
  ) {
    const refreshCookie = readRefreshTokenCookie(req)
    const currentTokenHash = refreshCookie ? this.tokenService.hashPlaintext(refreshCookie) : null
    return this.sessionService.listSessions(user.sub, query, currentTokenHash)
  }

  @Delete('sessions/:id')
  async revokeSession(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.sessionService.revokeSession(user.sub, id)
    return { revoked: true }
  }

  @Delete('sessions')
  async revokeAllOtherSessions(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    const refreshCookie = readRefreshTokenCookie(req)
    const currentTokenHash = refreshCookie ? this.tokenService.hashPlaintext(refreshCookie) : null
    await this.sessionService.revokeAllOtherSessions(user.sub, currentTokenHash)
    return { revoked: true }
  }

  @Post('reauth')
  async reauth(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReauthDto,
    @Req() req: Request,
  ) {
    const token = await this.reauthService.reauth(user.sub, dto, { ip: req.ip })
    return { signatureToken: token }
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.passwordLifecycleService.forgotPassword(dto.email, { ip: req.ip })
    // Deliberately identical response whether or not the email matched an account.
    return { sent: true }
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    await this.passwordLifecycleService.resetPassword(dto, { ip: req.ip })
    return { reset: true }
  }

  @Post('change-password')
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshCookie = readRefreshTokenCookie(req)
    const currentTokenHash = refreshCookie ? this.tokenService.hashPlaintext(refreshCookie) : null

    const updatedUser = await this.passwordLifecycleService.changePassword(
      user,
      dto,
      currentTokenHash,
      { ip: req.ip },
    )

    // tokenVersion just bumped — the current access token cookie is now
    // invalid too, so we re-sign one immediately to keep this session alive.
    const newAccessToken = this.tokenService.signAccessToken(updatedUser)
    setAccessTokenCookie(res, this.configService, newAccessToken)

    return { changed: true }
  }
}
