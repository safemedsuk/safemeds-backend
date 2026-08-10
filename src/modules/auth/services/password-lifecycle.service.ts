import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma, User } from '@prisma/client'
import { randomBytes } from 'crypto'

import { newId } from '../../../common/id'
import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../../common/rls/rls.service'
import { EnvConfig } from '../../../config/env.validation'
import { AuditService } from '../../audit/audit.service'
import { ChangePasswordDto } from '../dto/change-password.dto'
import { ResetPasswordDto } from '../dto/reset-password.dto'
import { getCompanyMinPasswordLength } from './company-password-policy.util'
import { MailService } from './mail.service'
import { PasswordService } from './password.service'
import { TokenService } from './token.service'
import { hashToken } from './token-hash.util'

export interface RequestMeta {
  ip?: string
}

@Injectable()
export class PasswordLifecycleService {
  constructor(
    private readonly rls: RlsService,
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly passwordService: PasswordService,
    private readonly mailService: MailService,
    private readonly tokenService: TokenService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Always resolves silently (the controller returns an identical 200 body
   * regardless of outcome) — this method's return value is deliberately
   * `void`, never "not found", so callers can't distinguish a real account
   * from a non-existent one by timing or response shape.
   *
   * Runs under `runWithSystemAccess`: resolving a user by email is
   * inherently a pre-authentication, cross-tenant-by-necessity lookup —
   * this is literally how the caller proves who they are.
   */
  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    const { user, plaintext, ttlMinutes } = await this.rls.runWithSystemAccess(async (tx) => {
      const foundUser = await tx.user.findUnique({ where: { email } })
      if (!foundUser || foundUser.status !== 'active') {
        return { user: null, plaintext: null, ttlMinutes: 0 }
      }

      const plaintextToken = randomBytes(32).toString('hex')
      const resetTtlMinutes = this.configService.get('PASSWORD_RESET_TOKEN_TTL_MINUTES', {
        infer: true,
      })
      const expiresAt = new Date(Date.now() + resetTtlMinutes * 60 * 1000)

      // Superseding any still-outstanding reset request keeps only the newest link valid.
      await tx.authToken.updateMany({
        where: { userId: foundUser.id, purpose: 'password_reset', consumedAt: null },
        data: { consumedAt: new Date() },
      })

      await tx.authToken.create({
        data: {
          id: newId(),
          userId: foundUser.id,
          purpose: 'password_reset',
          tokenHash: hashToken(plaintextToken),
          expiresAt,
        },
      })

      await this.auditService.log(tx, {
        companyId: foundUser.companyId,
        actorUserId: foundUser.id,
        action: 'password_reset_requested',
        recordType: 'app_user',
        recordId: foundUser.id,
        ip: meta.ip,
      })

      return { user: foundUser, plaintext: plaintextToken, ttlMinutes: resetTtlMinutes }
    })

    if (!user || !plaintext) {
      return
    }

    const resetUrl = `${this.configService.get('FRONTEND_URL', { infer: true })}/reset-password?token=${plaintext}`
    await this.mailService.sendPasswordResetLink(user.email, resetUrl, ttlMinutes)
  }

  /** Runs under `runWithSystemAccess` — a reset token, like the email above, is what establishes identity here; there is no company to scope by yet. */
  async resetPassword(dto: ResetPasswordDto, meta: RequestMeta): Promise<void> {
    const tokenHash = hashToken(dto.token)

    const { email, userId } = await this.rls.runWithSystemAccess(async (tx) => {
      const authToken = await tx.authToken.findUnique({
        where: { tokenHash },
        include: { user: { include: { company: true } } },
      })

      if (
        !authToken ||
        authToken.purpose !== 'password_reset' ||
        authToken.consumedAt ||
        authToken.expiresAt < new Date()
      ) {
        throw new UnauthorizedException({
          code: 'RESET_TOKEN_INVALID',
          message: 'This password reset link is invalid or has expired',
        })
      }

      const minLength = await getCompanyMinPasswordLength(
        tx,
        this.configService,
        authToken.user.companyId,
      )
      this.passwordService.assertPolicy(dto.newPassword, {
        fullName: authToken.user.fullName,
        companyName: authToken.user.company?.name,
        minLength,
      })

      const passwordHash = await this.passwordService.hash(dto.newPassword)

      await tx.user.update({
        where: { id: authToken.userId },
        data: { passwordHash, tokenVersion: { increment: 1 }, mustChangePassword: false },
      })
      await tx.authToken.update({ where: { id: authToken.id }, data: { consumedAt: new Date() } })
      await this.auditService.log(tx, {
        companyId: authToken.user.companyId,
        actorUserId: authToken.userId,
        action: 'password_reset',
        recordType: 'app_user',
        recordId: authToken.userId,
        ip: meta.ip,
      })

      return { email: authToken.user.email, userId: authToken.userId }
    })

    await this.tokenService.revokeAllForUser(userId)
    await this.mailService.sendPasswordChangedConfirmation(email, new Date())
  }

  /**
   * Unlike `resetPassword`, the caller is already authenticated and proved
   * they know the current password — their own session is left intact
   * (the controller re-signs a fresh access-token cookie carrying the
   * bumped tokenVersion), only every *other* session gets logged out.
   * Company-scoped throughout: `actor.companyId` is already known from
   * the JWT.
   */
  async changePassword(
    actor: AuthenticatedUser,
    dto: ChangePasswordDto,
    currentTokenHash: string | null,
    meta: RequestMeta,
  ): Promise<User> {
    const doChange = async (tx: Prisma.TransactionClient): Promise<User> => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: actor.sub },
        include: { company: true },
      })

      const currentValid = await this.passwordService.verify(user.passwordHash, dto.currentPassword)
      if (!currentValid) {
        throw new UnauthorizedException({
          code: 'INVALID_CURRENT_PASSWORD',
          message: 'Current password is incorrect',
        })
      }

      const minLength = await getCompanyMinPasswordLength(tx, this.configService, user.companyId)
      this.passwordService.assertPolicy(dto.newPassword, {
        fullName: user.fullName,
        companyName: user.company?.name,
        minLength,
      })

      const passwordHash = await this.passwordService.hash(dto.newPassword)

      const updatedUser = await tx.user.update({
        where: { id: actor.sub },
        data: { passwordHash, tokenVersion: { increment: 1 }, mustChangePassword: false },
      })
      await this.auditService.log(tx, {
        companyId: user.companyId,
        actorUserId: actor.sub,
        action: 'password_changed',
        recordType: 'app_user',
        recordId: actor.sub,
        ip: meta.ip,
      })

      return updatedUser
    }

    const updated = actor.companyId
      ? await this.rls.runAsCompany(actor.companyId, doChange)
      : await this.rls.runWithSystemAccess(doChange)

    await this.tokenService.revokeAllForUserExcept(actor.sub, currentTokenHash)
    await this.mailService.sendPasswordChangedConfirmation(updated.email, new Date())

    return updated
  }
}
