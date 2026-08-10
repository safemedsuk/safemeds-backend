import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { User } from '@prisma/client'

import { RlsService } from '../../../common/rls/rls.service'
import { EnvConfig } from '../../../config/env.validation'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from '../../audit/audit.service'
import { ReauthDto } from '../dto/reauth.dto'
import { decryptSecret } from './mfa-encryption.util'
import { computeMfaSetupRequired } from './mfa-setup-required.util'
import { PasswordService } from './password.service'
import { SignatureTokenService } from './signature-token.service'
import { verifyTotpCode } from './totp.util'

export interface RequestMeta {
  ip?: string
}

@Injectable()
export class ReauthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsService,
    private readonly passwordService: PasswordService,
    private readonly signatureTokenService: SignatureTokenService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  async reauth(userId: string, dto: ReauthDto, meta: RequestMeta): Promise<string> {
    const user = await this.verifyCredentials(userId, dto, meta, 'reauth_failed')

    // A role granted mid-session (e.g. Users & Roles) is never re-checked
    // against the login-time `mfaSetupRequired` flag — without this, a
    // signature-gated role holder with no MFA set up could mint a
    // signature token with just their password, defeating the whole
    // point of `securityPolicy.mfaRequiredForSignatureRoles`. Distinct
    // error code from `MFA_CODE_REQUIRED` (below) so the FE can tell "you
    // have MFA, type your code" apart from "you need to set MFA up
    // first" and route to the right screen instead of a dead-end error.
    const mfaSetupRequired = await this.rls.runWithSystemAccess((tx) =>
      computeMfaSetupRequired(tx, user),
    )
    if (mfaSetupRequired) {
      throw new ForbiddenException({
        code: 'MFA_SETUP_REQUIRED',
        message:
          'Your role requires multi-factor authentication before you can sign. Set it up in Settings first.',
      })
    }

    const token = await this.signatureTokenService.issue(userId)

    await this.auditService.log(this.prisma, {
      companyId: user.companyId,
      actorUserId: userId,
      action: 'reauth',
      recordType: 'app_user',
      recordId: userId,
      ip: meta.ip,
    })

    return token
  }

  /**
   * Shared password (+ MFA code, if active) verification used anywhere the
   * spec requires "re-auth" as a gate — `POST /auth/reauth` itself, and
   * MFA disable / recovery-code regeneration, which need the same proof of
   * presence without minting a Phase-6 signature token. Throws on failure
   * (auditing under `failureAction`); returns the verified user on success.
   */
  async verifyCredentials(
    userId: string,
    dto: ReauthDto,
    meta: RequestMeta,
    failureAction: string,
  ): Promise<User> {
    const user = await this.rls.runWithSystemAccess((tx) =>
      tx.user.findUniqueOrThrow({ where: { id: userId } }),
    )

    const passwordValid = await this.passwordService.verify(user.passwordHash, dto.password)
    if (!passwordValid) {
      await this.auditFailure(userId, user.companyId, meta, failureAction, 'Incorrect password')
      throw new UnauthorizedException({ code: 'REAUTH_FAILED', message: 'Incorrect password' })
    }

    const mfaCredential = await this.prisma.mfaCredential.findUnique({ where: { userId } })
    const mfaActive = Boolean(mfaCredential?.enabledAt)

    if (mfaActive) {
      if (!dto.mfaCode) {
        throw new ForbiddenException({ code: 'MFA_CODE_REQUIRED', message: 'MFA code is required' })
      }

      const secret = decryptSecret(
        mfaCredential!.secretEncrypted,
        this.configService.get('MFA_ENCRYPTION_KEY', { infer: true }),
      )
      const codeValid = await verifyTotpCode(secret, dto.mfaCode)

      if (!codeValid) {
        await this.auditFailure(userId, user.companyId, meta, failureAction, 'Incorrect MFA code')
        throw new UnauthorizedException({ code: 'REAUTH_FAILED', message: 'Incorrect MFA code' })
      }
    }

    return user
  }

  private async auditFailure(
    userId: string,
    companyId: string | null,
    meta: RequestMeta,
    action: string,
    reason: string,
  ): Promise<void> {
    await this.auditService.log(this.prisma, {
      companyId,
      actorUserId: userId,
      action,
      recordType: 'app_user',
      recordId: userId,
      newValue: { reason },
      ip: meta.ip,
    })
  }
}
