import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { User } from '@prisma/client'
import { createHash, randomBytes } from 'crypto'

import { newId } from '../../../common/id'
import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../../common/rls/rls.service'
import { EnvConfig } from '../../../config/env.validation'
import { PrismaService } from '../../../prisma/prisma.service'

export interface IssuedRefreshToken {
  plaintext: string
  familyId: string
  expiresAt: Date
}

export interface RefreshResult {
  user: User
  accessToken: string
  refreshToken: IssuedRefreshToken
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly prisma: PrismaService,
    private readonly rls: RlsService,
  ) {}

  hashPlaintext(token: string): string {
    return hashToken(token)
  }

  signAccessToken(user: User): string {
    const payload: AuthenticatedUser = {
      sub: user.id,
      companyId: user.companyId,
      roleKeys: user.roleKeys,
      platformRole: user.platformRole,
      tokenVersion: user.tokenVersion,
    }

    return this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: this.configService.get('JWT_ACCESS_EXPIRES_IN', { infer: true }),
    })
  }

  /** Issues a brand-new refresh token family (new login). */
  async issueRefreshTokenFamily(
    userId: string,
    meta: { device?: string; ip?: string; userAgent?: string },
  ): Promise<IssuedRefreshToken> {
    const plaintext = randomBytes(32).toString('hex')
    const familyId = newId()
    const expiresAt = this.refreshExpiresAt()

    await this.prisma.refreshToken.create({
      data: {
        id: newId(),
        userId,
        tokenHash: hashToken(plaintext),
        familyId,
        device: meta.device,
        ip: meta.ip,
        userAgent: meta.userAgent,
        expiresAt,
      },
    })

    return { plaintext, familyId, expiresAt }
  }

  /**
   * Rotates a refresh token: the presented token is consumed and a new one
   * issued in the same family. If the presented token was already
   * consumed/revoked, this is reuse of a stolen token — the whole family
   * is revoked and the caller must re-authenticate.
   */
  async rotate(
    plaintextToken: string,
    meta: { device?: string; ip?: string; userAgent?: string },
  ): Promise<RefreshResult> {
    const tokenHash = hashToken(plaintextToken)
    // `refresh_token` itself has no RLS, but `app_user` does (FORCE ROW
    // LEVEL SECURITY) — a bare `this.prisma` read with no session context
    // set makes the RLS policy filter the joined `user` row to nothing,
    // and Prisma throws (`user` is a required, non-optional relation)
    // rather than silently returning null. Every refresh, for every user,
    // failed with a 500 until this was wrapped — the exact "Prisma
    // include is subject to RLS on the joined table" gotcha, just not
    // yet fixed in this one spot. `runWithSystemAccess` is correct here:
    // at this point we only have a *token*, not yet a trusted companyId.
    const existing = await this.rls.runWithSystemAccess((tx) =>
      tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      }),
    )

    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token')
    }

    if (existing.revokedAt || existing.expiresAt < new Date()) {
      await this.revokeFamily(existing.familyId)
      throw new UnauthorizedException('Refresh token reuse detected')
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    })

    const newPlaintext = randomBytes(32).toString('hex')
    const expiresAt = this.refreshExpiresAt()

    await this.prisma.refreshToken.create({
      data: {
        id: newId(),
        userId: existing.userId,
        tokenHash: hashToken(newPlaintext),
        familyId: existing.familyId,
        device: meta.device,
        ip: meta.ip,
        userAgent: meta.userAgent,
        expiresAt,
      },
    })

    return {
      user: existing.user,
      accessToken: this.signAccessToken(existing.user),
      refreshToken: { plaintext: newPlaintext, familyId: existing.familyId, expiresAt },
    }
  }

  async revoke(plaintextToken: string): Promise<void> {
    const tokenHash = hashToken(plaintextToken)
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  /** Revokes every active session for a user — used by password reset/admin-reset, where there is no "current session" to spare. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  /** Revokes every active session for a user except the one whose refresh token hashes to `currentTokenHash`. */
  async revokeAllForUserExcept(userId: string, currentTokenHash: string | null): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(currentTokenHash ? { tokenHash: { not: currentTokenHash } } : {}),
      },
      data: { revokedAt: new Date() },
    })
  }

  private refreshExpiresAt(): Date {
    const days = this.configService.get('JWT_REFRESH_EXPIRES_IN_DAYS', { infer: true })
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  }
}
