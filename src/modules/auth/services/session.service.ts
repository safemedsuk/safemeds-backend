import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Company, User } from '@prisma/client'

import { newId } from '../../../common/id'
import { paginate, PaginatedResult, PaginationQueryDto } from '../../../common/pagination'
import { RlsService } from '../../../common/rls/rls.service'
import { EnvConfig } from '../../../config/env.validation'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from '../../audit/audit.service'
import { LoginDto } from '../dto/login.dto'
import { describeDevice } from './device.util'
import { MfaPendingTokenService } from './mfa-pending-token.service'
import { computeMfaSetupRequired } from './mfa-setup-required.util'
import { PasswordService } from './password.service'
import { SessionActivityService } from './session-activity.service'
import { IssuedRefreshToken, TokenService } from './token.service'

/** Platform staff have no `SecurityPolicy` row (that's a per-tenant-company concept) — this is the fixed idle-timeout backstop for them, matching the same "5 minutes, especially for patient data" default every new tenant company gets. */
const PLATFORM_STAFF_IDLE_TIMEOUT_MINUTES = 5

export interface RequestMeta {
  ip?: string
  userAgent?: string
}

export interface LoginSuccessResult {
  mfaRequired: false
  user: User & { company: Company | null }
  accessToken: string
  refreshToken: IssuedRefreshToken
  mfaSetupRequired: boolean
}

export interface LoginMfaPendingResult {
  mfaRequired: true
  mfaPendingToken: string
  mfaPendingExpiresInSeconds: number
}

export type LoginResult = LoginSuccessResult | LoginMfaPendingResult

export interface SessionDto {
  id: string
  device: string
  ip: string | null
  createdAt: Date
  isCurrent: boolean
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsService,
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly auditService: AuditService,
    private readonly mfaPendingTokenService: MfaPendingTokenService,
    private readonly sessionActivityService: SessionActivityService,
  ) {}

  /**
   * Resolving a user by email is exactly the "who's asking" step —
   * `app_user` has RLS enforced (Phase 2.3), so this whole bootstrapping
   * sequence (identity lookup, and the security-policy read a few lines
   * later once we know the company) runs under `runWithSystemAccess`.
   * Once a session actually exists, everything downstream uses
   * `runAsCompany` instead — see UsersService/InvitationsService.
   */
  async login(dto: LoginDto, meta: RequestMeta): Promise<LoginResult> {
    await this.assertNotLocked(dto.email)

    const user = await this.rls.runWithSystemAccess((tx) =>
      tx.user.findUnique({ where: { email: dto.email }, include: { company: true } }),
    )

    if (!user) {
      throw await this.buildFailureError(dto.email, null, meta)
    }

    if (user.status === 'deactivated') {
      await this.recordAttempt(dto.email, user.id, false, meta)
      throw new ForbiddenException({
        code: 'ACCOUNT_DEACTIVATED',
        message: 'This account has been deactivated',
      })
    }

    if (user.company && user.company.status === 'suspended') {
      await this.recordAttempt(dto.email, user.id, false, meta)
      throw new ForbiddenException({
        code: 'COMPANY_SUSPENDED',
        message: 'Your company account is suspended',
      })
    }

    const passwordValid = await this.passwordService.verify(user.passwordHash, dto.password)
    if (!passwordValid) {
      throw await this.buildFailureError(dto.email, user.id, meta)
    }

    await this.recordAttempt(dto.email, user.id, true, meta)

    const mfaCredential = await this.prisma.mfaCredential.findUnique({ where: { userId: user.id } })

    if (mfaCredential?.enabledAt) {
      const mfaPendingToken = await this.mfaPendingTokenService.issue(user.id)
      return {
        mfaRequired: true,
        mfaPendingToken,
        mfaPendingExpiresInSeconds: this.mfaPendingTokenService.ttlSeconds,
      }
    }

    const mfaSetupRequired = await this.rls.runWithSystemAccess((tx) =>
      computeMfaSetupRequired(tx, user),
    )
    return this.issueSession(user, meta, { mfaSetupRequired })
  }

  /** Called by `MfaService.challenge` once the TOTP/recovery code checks out — issues the real session. */
  async completeMfaLogin(userId: string, meta: RequestMeta): Promise<LoginSuccessResult> {
    return this.issueSessionForUser(userId, meta)
  }

  /**
   * Issues a full session for a user who has already proven themselves
   * outside the normal login form — MFA challenge completion and
   * post-invitation-acceptance email verification are the callers today.
   * No lockout/password branching here: that only applies to the
   * password-form entry point. `mfaSetupRequired` is still computed fresh
   * (self-contained: it checks whether MFA is already active before
   * flagging anything), since a just-invited user can land here already
   * holding a signature-gated role under a policy that requires MFA.
   *
   * Same `runWithSystemAccess` reasoning as `login()` — the caller has
   * proven a *userId* (via an MFA-pending token or invitation-verify
   * code), not yet a full session with a trusted companyId claim.
   */
  async issueSessionForUser(userId: string, meta: RequestMeta): Promise<LoginSuccessResult> {
    const { user, mfaSetupRequired } = await this.rls.runWithSystemAccess(async (tx) => {
      const foundUser = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { company: true },
      })
      return { user: foundUser, mfaSetupRequired: await computeMfaSetupRequired(tx, foundUser) }
    })
    return this.issueSession(user, meta, { mfaSetupRequired })
  }

  private async issueSession(
    user: User & { company: Company | null },
    meta: RequestMeta,
    opts: { mfaSetupRequired: boolean },
  ): Promise<LoginSuccessResult> {
    const accessToken = this.tokenService.signAccessToken(user)
    const refreshToken = await this.tokenService.issueRefreshTokenFamily(user.id, {
      device: describeDevice(meta.userAgent),
      ip: meta.ip,
      userAgent: meta.userAgent,
    })

    await this.auditService.log(this.prisma, {
      companyId: user.companyId,
      actorUserId: user.id,
      action: 'login',
      recordType: 'app_user',
      recordId: user.id,
      ip: meta.ip,
    })

    // A brand-new session shouldn't look "idle forever" to the Stage 0.7
    // backstop before the first authenticated request ever runs.
    this.sessionActivityService.touch(user.id)

    return {
      mfaRequired: false,
      user,
      accessToken,
      refreshToken,
      mfaSetupRequired: opts.mfaSetupRequired,
    }
  }

  async refresh(refreshTokenPlaintext: string, meta: RequestMeta) {
    const result = await this.tokenService.rotate(refreshTokenPlaintext, {
      device: describeDevice(meta.userAgent),
      ip: meta.ip,
      userAgent: meta.userAgent,
    })

    if (result.user.status !== 'active') {
      await this.tokenService.revokeFamily(result.refreshToken.familyId)
      throw new UnauthorizedException({
        code: 'ACCOUNT_DEACTIVATED',
        message: 'This account has been deactivated',
      })
    }

    await this.enforceIdleTimeout(result.user, result.refreshToken.familyId)
    this.sessionActivityService.touch(result.user.id)

    return result
  }

  /**
   * Stage 0.7's backend backstop — the frontend's own idle timer is the
   * primary enforcement (it logs a user out client-side before this
   * would ever be reached in normal use). Fails open (allows the
   * refresh) whenever there's no activity signal at all — a Redis
   * hiccup, or a session that predates this feature — rather than
   * locking someone out on ambiguous information; the real security
   * boundary here is "was this session demonstrably idle," not "can we
   * prove it wasn't."
   */
  private async enforceIdleTimeout(user: User, familyId: string): Promise<void> {
    const idleMinutes = await this.sessionActivityService.idleMinutesSince(user.id)
    if (idleMinutes === null) {
      return
    }

    const timeoutMinutes = user.companyId
      ? await this.getCompanySessionTimeoutMinutes(user.companyId)
      : PLATFORM_STAFF_IDLE_TIMEOUT_MINUTES

    if (idleMinutes > timeoutMinutes) {
      await this.tokenService.revokeFamily(familyId)
      throw new UnauthorizedException({
        code: 'SESSION_IDLE_TIMEOUT',
        message: 'Your session expired due to inactivity. Please log in again.',
      })
    }
  }

  private async getCompanySessionTimeoutMinutes(companyId: string): Promise<number> {
    const policy = await this.rls.runAsCompany(companyId, (tx) =>
      tx.securityPolicy.findUnique({ where: { companyId } }),
    )
    return policy?.sessionTimeoutMinutes ?? PLATFORM_STAFF_IDLE_TIMEOUT_MINUTES
  }

  async logout(refreshTokenPlaintext: string): Promise<void> {
    await this.tokenService.revoke(refreshTokenPlaintext)
  }

  async listSessions(
    userId: string,
    query: PaginationQueryDto,
    currentTokenHash: string | null,
  ): Promise<PaginatedResult<SessionDto>> {
    const where = { userId, revokedAt: null, expiresAt: { gt: new Date() } }

    const [rows, total] = await Promise.all([
      this.prisma.refreshToken.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.refreshToken.count({ where }),
    ])

    const sessions: SessionDto[] = rows.map((row) => ({
      id: row.id,
      device: row.device ?? 'Unknown device',
      ip: row.ip,
      createdAt: row.createdAt,
      isCurrent: currentTokenHash !== null && row.tokenHash === currentTokenHash,
    }))

    return paginate(sessions, total, query)
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.refreshToken.findFirst({ where: { id: sessionId, userId } })
    if (!session) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Session not found' })
    }

    await this.prisma.refreshToken.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    })
  }

  async revokeAllOtherSessions(userId: string, currentTokenHash: string | null): Promise<void> {
    const currentSessionId = currentTokenHash ? await this.resolveSessionId(currentTokenHash) : null

    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    })
  }

  private async resolveSessionId(tokenHash: string): Promise<string | null> {
    const session = await this.prisma.refreshToken.findUnique({ where: { tokenHash } })
    return session?.id ?? null
  }

  private async assertNotLocked(email: string): Promise<void> {
    const windowMinutes = this.configService.get('LOGIN_LOCKOUT_WINDOW_MINUTES', { infer: true })
    const maxAttempts = this.configService.get('LOGIN_LOCKOUT_MAX_ATTEMPTS', { infer: true })
    const lockoutDurationMinutes = this.configService.get('LOGIN_LOCKOUT_DURATION_MINUTES', {
      infer: true,
    })

    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000)
    const recentFailures = await this.prisma.loginAttempt.findMany({
      where: { email, success: false, occurredAt: { gte: windowStart } },
      orderBy: { occurredAt: 'desc' },
      take: maxAttempts,
    })

    if (recentFailures.length < maxAttempts) {
      return
    }

    const mostRecentFailure = recentFailures[0].occurredAt
    const unlockAt = new Date(mostRecentFailure.getTime() + lockoutDurationMinutes * 60 * 1000)

    if (unlockAt > new Date()) {
      throw new HttpException(
        {
          code: 'ACCOUNT_LOCKED',
          message: 'Too many failed login attempts. Try again later.',
          unlockAt: unlockAt.toISOString(),
        },
        HttpStatus.LOCKED,
      )
    }
  }

  private async recordAttempt(
    email: string,
    userId: string | null,
    success: boolean,
    meta: RequestMeta,
  ): Promise<void> {
    await this.prisma.loginAttempt.create({
      data: {
        id: newId(),
        email,
        userId,
        success,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    })

    if (!success) {
      await this.auditService.log(this.prisma, {
        actorUserId: userId,
        actorType: 'user',
        action: 'login_failed',
        recordType: 'app_user',
        recordId: userId,
        ip: meta.ip,
      })
    }
  }

  /**
   * Records a genuine wrong-credentials failure and returns the exception
   * to throw at the call site (as `throw await this.buildFailureError(...)`,
   * so TypeScript can see the unconditional throw and narrow `user`
   * afterward — a plain `Promise<never>`-returning method that throws
   * internally doesn't propagate that narrowing through `await`).
   *
   * Either ACCOUNT_LOCKED (if this failure tipped the count over the
   * threshold — the user finds out immediately, not one attempt later) or
   * INVALID_CREDENTIALS carrying how many attempts remain, so the UI can
   * warn before the account actually locks.
   */
  private async buildFailureError(
    email: string,
    userId: string | null,
    meta: RequestMeta,
  ): Promise<HttpException> {
    await this.recordAttempt(email, userId, false, meta)

    const windowMinutes = this.configService.get('LOGIN_LOCKOUT_WINDOW_MINUTES', { infer: true })
    const maxAttempts = this.configService.get('LOGIN_LOCKOUT_MAX_ATTEMPTS', { infer: true })
    const lockoutDurationMinutes = this.configService.get('LOGIN_LOCKOUT_DURATION_MINUTES', {
      infer: true,
    })

    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000)
    const recentFailures = await this.prisma.loginAttempt.findMany({
      where: { email, success: false, occurredAt: { gte: windowStart } },
      orderBy: { occurredAt: 'desc' },
      take: maxAttempts,
    })

    if (recentFailures.length >= maxAttempts) {
      const unlockAt = new Date(
        recentFailures[0].occurredAt.getTime() + lockoutDurationMinutes * 60 * 1000,
      )
      return new HttpException(
        {
          code: 'ACCOUNT_LOCKED',
          message: 'Too many failed login attempts. Try again later.',
          unlockAt: unlockAt.toISOString(),
        },
        HttpStatus.LOCKED,
      )
    }

    return new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
      attemptsRemaining: maxAttempts - recentFailures.length,
    })
  }
}
