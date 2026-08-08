import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import * as QRCode from 'qrcode'

import { newId } from '../../../common/id'
import { RlsService } from '../../../common/rls/rls.service'
import { EnvConfig } from '../../../config/env.validation'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from '../../audit/audit.service'
import { MfaChallengeDto } from '../dto/mfa-challenge.dto'
import { MfaVerifySetupDto } from '../dto/mfa-verify-setup.dto'
import { ReauthDto } from '../dto/reauth.dto'
import { decryptSecret, encryptSecret } from './mfa-encryption.util'
import { RequestMeta } from './reauth.service'
import { ReauthService } from './reauth.service'
import { generateRecoveryCodes } from './recovery-codes.util'
import { hashToken } from './token-hash.util'
import { generateTotpSecret, generateTotpUri, verifyTotpCode } from './totp.util'

interface RecoveryCodeRecord {
  hash: string
  usedAt: string | null
}

export interface MfaSetupResult {
  secret: string
  otpauthUri: string
  qrCodeDataUrl: string
}

export interface MfaVerifySetupResult {
  recoveryCodes: string[]
}

const ISSUER = 'SafeMeds'

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsService,
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly auditService: AuditService,
    private readonly reauthService: ReauthService,
  ) {}

  async setup(userId: string): Promise<MfaSetupResult> {
    const user = await this.rls.runWithSystemAccess((tx) =>
      tx.user.findUniqueOrThrow({ where: { id: userId } }),
    )
    const existing = await this.prisma.mfaCredential.findUnique({ where: { userId } })

    if (existing?.enabledAt) {
      throw new ConflictException({
        code: 'MFA_ALREADY_ENABLED',
        message: 'MFA is already enabled on this account',
      })
    }

    const secret = generateTotpSecret()
    const secretEncrypted = encryptSecret(
      secret,
      this.configService.get('MFA_ENCRYPTION_KEY', { infer: true }),
    )

    await this.prisma.mfaCredential.upsert({
      where: { userId },
      create: { id: newId(), userId, method: 'totp', secretEncrypted, enabledAt: null },
      update: { secretEncrypted, enabledAt: null, recoveryCodesHashed: Prisma.DbNull },
    })

    const otpauthUri = generateTotpUri(ISSUER, user.email, secret)
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri)

    return { secret, otpauthUri, qrCodeDataUrl }
  }

  async verifySetup(
    userId: string,
    dto: MfaVerifySetupDto,
    meta: RequestMeta,
  ): Promise<MfaVerifySetupResult> {
    const user = await this.rls.runWithSystemAccess((tx) =>
      tx.user.findUniqueOrThrow({ where: { id: userId } }),
    )
    const credential = await this.prisma.mfaCredential.findUnique({ where: { userId } })
    if (!credential || credential.enabledAt) {
      throw new BadRequestException({
        code: 'MFA_SETUP_NOT_STARTED',
        message: 'No pending MFA setup found — call setup first',
      })
    }

    const secret = decryptSecret(
      credential.secretEncrypted,
      this.configService.get('MFA_ENCRYPTION_KEY', { infer: true }),
    )
    const codeValid = await verifyTotpCode(secret, dto.code)

    if (!codeValid) {
      throw new UnauthorizedException({
        code: 'MFA_CODE_INVALID',
        message: 'Incorrect verification code',
      })
    }

    const recoveryCodes = generateRecoveryCodes()
    const recoveryCodesHashed: RecoveryCodeRecord[] = recoveryCodes.map((code) => ({
      hash: hashToken(code),
      usedAt: null,
    }))

    await this.prisma.$transaction(async (tx) => {
      await tx.mfaCredential.update({
        where: { userId },
        data: {
          enabledAt: new Date(),
          recoveryCodesHashed: recoveryCodesHashed as unknown as Prisma.InputJsonValue,
        },
      })

      await this.auditService.log(tx, {
        companyId: user.companyId,
        actorUserId: userId,
        action: 'mfa_enabled',
        recordType: 'app_user',
        recordId: userId,
        ip: meta.ip,
      })
    })

    return { recoveryCodes }
  }

  /**
   * Step 2 of MFA-gated login: consumes the mfa_pending proof-of-password
   * and the user's TOTP/recovery code. Actual session issuance happens in
   * `SessionService.completeMfaLogin` — this method only validates the code.
   */
  async challenge(userId: string, dto: MfaChallengeDto, meta: RequestMeta): Promise<void> {
    const credential = await this.prisma.mfaCredential.findUnique({ where: { userId } })
    if (!credential?.enabledAt) {
      throw new BadRequestException({
        code: 'MFA_NOT_ENABLED',
        message: 'MFA is not enabled on this account',
      })
    }

    if (dto.recoveryCode) {
      await this.consumeRecoveryCode(
        userId,
        credential.recoveryCodesHashed as RecoveryCodeRecord[] | null,
        dto.recoveryCode,
        meta,
      )
      return
    }

    if (!dto.code) {
      throw new BadRequestException({
        code: 'MFA_CODE_REQUIRED',
        message: 'A code or recovery code is required',
      })
    }

    const secret = decryptSecret(
      credential.secretEncrypted,
      this.configService.get('MFA_ENCRYPTION_KEY', { infer: true }),
    )
    const codeValid = await verifyTotpCode(secret, dto.code)

    if (!codeValid) {
      await this.auditService.log(this.prisma, {
        actorUserId: userId,
        action: 'mfa_challenge_failed',
        recordType: 'app_user',
        recordId: userId,
        ip: meta.ip,
      })
      throw new UnauthorizedException({
        code: 'MFA_CODE_INVALID',
        message: 'Incorrect verification code',
      })
    }
  }

  async disable(userId: string, dto: ReauthDto, meta: RequestMeta): Promise<void> {
    await this.reauthService.verifyCredentials(userId, dto, meta, 'mfa_disable_failed')

    const credential = await this.prisma.mfaCredential.findUnique({ where: { userId } })
    if (!credential) {
      throw new BadRequestException({
        code: 'MFA_NOT_ENABLED',
        message: 'MFA is not enabled on this account',
      })
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.mfaCredential.delete({ where: { userId } })

      await this.auditService.log(tx, {
        actorUserId: userId,
        action: 'mfa_disabled',
        recordType: 'app_user',
        recordId: userId,
        ip: meta.ip,
      })
    })
  }

  async regenerateRecoveryCodes(
    userId: string,
    dto: ReauthDto,
    meta: RequestMeta,
  ): Promise<MfaVerifySetupResult> {
    await this.reauthService.verifyCredentials(userId, dto, meta, 'mfa_recovery_regenerate_failed')

    const credential = await this.prisma.mfaCredential.findUnique({ where: { userId } })
    if (!credential?.enabledAt) {
      throw new BadRequestException({
        code: 'MFA_NOT_ENABLED',
        message: 'MFA is not enabled on this account',
      })
    }

    const recoveryCodes = generateRecoveryCodes()
    const recoveryCodesHashed: RecoveryCodeRecord[] = recoveryCodes.map((code) => ({
      hash: hashToken(code),
      usedAt: null,
    }))

    await this.prisma.$transaction(async (tx) => {
      await tx.mfaCredential.update({
        where: { userId },
        data: { recoveryCodesHashed: recoveryCodesHashed as unknown as Prisma.InputJsonValue },
      })

      await this.auditService.log(tx, {
        actorUserId: userId,
        action: 'mfa_recovery_codes_regenerated',
        recordType: 'app_user',
        recordId: userId,
        ip: meta.ip,
      })
    })

    return { recoveryCodes }
  }

  private async consumeRecoveryCode(
    userId: string,
    records: RecoveryCodeRecord[] | null,
    plaintext: string,
    meta: RequestMeta,
  ): Promise<void> {
    const hash = hashToken(plaintext.trim().toUpperCase())
    const match = records?.find((record) => record.hash === hash && !record.usedAt)

    if (!match) {
      await this.auditService.log(this.prisma, {
        actorUserId: userId,
        action: 'mfa_challenge_failed',
        recordType: 'app_user',
        recordId: userId,
        newValue: { reason: 'Invalid or already-used recovery code' },
        ip: meta.ip,
      })
      throw new ForbiddenException({
        code: 'RECOVERY_CODE_INVALID',
        message: 'Invalid or already-used recovery code',
      })
    }

    const updated = (records ?? []).map((record) =>
      record.hash === hash ? { ...record, usedAt: new Date().toISOString() } : record,
    )

    await this.prisma.$transaction(async (tx) => {
      await tx.mfaCredential.update({
        where: { userId },
        data: { recoveryCodesHashed: updated as unknown as Prisma.InputJsonValue },
      })

      await this.auditService.log(tx, {
        actorUserId: userId,
        action: 'mfa_recovery_code_used',
        recordType: 'app_user',
        recordId: userId,
        ip: meta.ip,
      })
    })
  }
}
