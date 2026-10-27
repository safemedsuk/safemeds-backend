import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Invitation, Prisma } from '@prisma/client'
import { randomBytes, randomInt } from 'crypto'

import { resolveLocale } from '../../common/i18n/locale'
import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { formatRoleLabel, isValidTenantRoleKey } from '../../common/tenant-roles.const'
import { EnvConfig } from '../../config/env.validation'
import { AuditService } from '../audit/audit.service'
import { getCompanyMinPasswordLength } from '../auth/services/company-password-policy.util'
import { MailService } from '../auth/services/mail.service'
import { PasswordService } from '../auth/services/password.service'
import { hashToken } from '../auth/services/token-hash.util'
import { AcceptInvitationDto } from './dto/accept-invitation.dto'
import { CreateInvitationDto } from './dto/create-invitation.dto'
import { ListInvitationsQueryDto } from './dto/list-invitations-query.dto'

export interface RequestMeta {
  ip?: string
}

export interface InvitationLookup {
  companyName: string
  inviterName: string
  roleKeys: string[]
  email: string
  expiresAt: Date
  /** The company's current password policy, so the accept form's requirements checklist reflects it rather than a hardcoded platform floor. */
  minPasswordLength: number
}

function generateNumericCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly rls: RlsService,
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly mailService: MailService,
    private readonly passwordService: PasswordService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    dto: CreateInvitationDto,
    meta: RequestMeta,
  ): Promise<Invitation> {
    this.assertTenantAdmin(actor)

    const invalidRole = dto.roleKeys.find((key) => !isValidTenantRoleKey(key))
    if (invalidRole) {
      throw new BadRequestException({
        code: 'INVALID_ROLE',
        message: `Unknown role: ${invalidRole}`,
      })
    }

    // Global email uniqueness spans every company — can't be answered from
    // inside a single company's RLS context, hence system access for this
    // one check only.
    const existingUser = await this.rls.runWithSystemAccess((tx) =>
      tx.user.findUnique({ where: { email: dto.email } }),
    )
    if (existingUser) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'An account already exists for this email address',
      })
    }

    const { invitation, company, inviter, plaintext } = await this.rls.runAsCompany(
      actor.companyId!,
      async (tx) => {
        const existingPending = await tx.invitation.findFirst({
          where: { companyId: actor.companyId!, email: dto.email, status: 'pending' },
        })
        if (existingPending) {
          throw new ConflictException({
            code: 'INVITATION_ALREADY_PENDING',
            message: 'An invitation is already pending for this email address',
          })
        }

        const companyRow = await tx.company.findUniqueOrThrow({ where: { id: actor.companyId! } })
        const inviterRow = await tx.user.findUniqueOrThrow({ where: { id: actor.sub } })
        const { plaintext: token, tokenHash, expiresAt } = this.issueToken()

        const created = await tx.invitation.create({
          data: {
            id: newId(),
            companyId: actor.companyId!,
            email: dto.email,
            roleKeys: dto.roleKeys,
            isExternal: dto.isExternal ?? false,
            tokenHash,
            invitedBy: actor.sub,
            expiresAt,
          },
        })

        await this.auditService.log(tx, {
          companyId: actor.companyId,
          actorUserId: actor.sub,
          action: 'invitation_created',
          recordType: 'invitation',
          recordId: created.id,
          newValue: {
            email: dto.email,
            roleKeys: dto.roleKeys,
            isExternal: dto.isExternal ?? false,
          },
          ip: meta.ip,
        })

        return { invitation: created, company: companyRow, inviter: inviterRow, plaintext: token }
      },
    )

    await this.sendInvitationEmail(invitation, company.name, inviter.fullName, plaintext)

    return invitation
  }

  async list(
    actor: AuthenticatedUser,
    query: ListInvitationsQueryDto,
  ): Promise<PaginatedResult<Invitation>> {
    this.assertTenantAdmin(actor)

    return this.rls.runAsCompany(actor.companyId!, async (tx) => {
      const where = {
        companyId: actor.companyId!,
        ...(query.status ? { status: query.status } : {}),
      }

      const [rows, total] = await Promise.all([
        tx.invitation.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.invitation.count({ where }),
      ])

      return paginate(rows, total, query)
    })
  }

  async resend(actor: AuthenticatedUser, invitationId: string, meta: RequestMeta): Promise<void> {
    this.assertTenantAdmin(actor)

    const { updated, company, inviter, plaintext } = await this.rls.runAsCompany(
      actor.companyId!,
      async (tx) => {
        const invitation = await tx.invitation.findFirst({
          where: { id: invitationId, companyId: actor.companyId! },
        })
        if (!invitation) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Invitation not found' })
        }
        if (invitation.status !== 'pending' && invitation.status !== 'expired') {
          throw new BadRequestException({
            code: 'INVITATION_NOT_RESENDABLE',
            message: 'This invitation can no longer be resent',
          })
        }

        const companyRow = await tx.company.findUniqueOrThrow({ where: { id: actor.companyId! } })
        const inviterRow = await tx.user.findUniqueOrThrow({ where: { id: actor.sub } })
        const { plaintext: token, tokenHash, expiresAt } = this.issueToken()

        const result = await tx.invitation.update({
          where: { id: invitation.id },
          data: { tokenHash, expiresAt, status: 'pending' },
        })

        await this.auditService.log(tx, {
          companyId: actor.companyId,
          actorUserId: actor.sub,
          action: 'invitation_resent',
          recordType: 'invitation',
          recordId: invitation.id,
          ip: meta.ip,
        })

        return { updated: result, company: companyRow, inviter: inviterRow, plaintext: token }
      },
    )

    await this.sendInvitationEmail(updated, company.name, inviter.fullName, plaintext)
  }

  async revoke(actor: AuthenticatedUser, invitationId: string, meta: RequestMeta): Promise<void> {
    this.assertTenantAdmin(actor)

    await this.rls.runAsCompany(actor.companyId!, async (tx) => {
      const invitation = await tx.invitation.findFirst({
        where: { id: invitationId, companyId: actor.companyId! },
      })
      if (!invitation) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Invitation not found' })
      }
      if (invitation.status !== 'pending') {
        throw new BadRequestException({
          code: 'INVITATION_NOT_REVOCABLE',
          message: 'Only a pending invitation can be revoked',
        })
      }

      await tx.invitation.update({ where: { id: invitation.id }, data: { status: 'revoked' } })
      await this.auditService.log(tx, {
        companyId: actor.companyId,
        actorUserId: actor.sub,
        action: 'invitation_revoked',
        recordType: 'invitation',
        recordId: invitation.id,
        ip: meta.ip,
      })
    })
  }

  /** Public, pre-authentication — the invitation *token* is the identity here, so this whole lookup runs under system access. */
  async lookup(token: string): Promise<InvitationLookup> {
    return this.rls.runWithSystemAccess(async (tx) => {
      const invitation = await this.findValidByToken(tx, token)
      const company = await tx.company.findUniqueOrThrow({ where: { id: invitation.companyId } })
      const inviter = await tx.user.findUniqueOrThrow({ where: { id: invitation.invitedBy } })
      const minPasswordLength = await getCompanyMinPasswordLength(
        tx,
        this.configService,
        invitation.companyId,
      )

      return {
        companyName: company.name,
        inviterName: inviter.fullName,
        roleKeys: invitation.roleKeys,
        email: invitation.email,
        expiresAt: invitation.expiresAt,
        minPasswordLength,
      }
    })
  }

  /**
   * Creates the User with the pre-assigned roles (never self-selected) and
   * marks the invitation accepted, then emails a 6-digit code — the same
   * 1.3 mechanism — instead of issuing a session directly. `verifyEmail`
   * below is what actually logs them in; the User row has no "pending"
   * state to lean on (`UserStatus` is only active/deactivated), so this
   * code is the proof of inbox ownership the spec calls for. Public,
   * pre-authentication — system access throughout (including the CREATE,
   * which needs the RLS bypass flag to satisfy `app_user`'s WITH CHECK).
   */
  async accept(
    token: string,
    dto: AcceptInvitationDto,
    meta: RequestMeta,
  ): Promise<{ email: string }> {
    const { email, code, ttlMinutes } = await this.rls.runWithSystemAccess(async (tx) => {
      const invitation = await this.findValidByToken(tx, token)

      const existingUser = await tx.user.findUnique({ where: { email: invitation.email } })
      if (existingUser) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'An account already exists for this email address',
        })
      }

      const minLength = await getCompanyMinPasswordLength(
        tx,
        this.configService,
        invitation.companyId,
      )
      this.passwordService.assertPolicy(dto.password, { fullName: dto.fullName, minLength })
      const passwordHash = await this.passwordService.hash(dto.password)

      const verificationCode = generateNumericCode()
      const codeTtlMinutes = this.configService.get('EMAIL_VERIFICATION_CODE_TTL_MINUTES', {
        infer: true,
      })

      const created = await tx.user.create({
        data: {
          id: newId(),
          companyId: invitation.companyId,
          email: invitation.email,
          fullName: dto.fullName,
          passwordHash,
          roleKeys: invitation.roleKeys,
          isExternal: invitation.isExternal,
        },
      })

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'accepted', acceptedByUserId: created.id },
      })

      await tx.authToken.create({
        data: {
          id: newId(),
          userId: created.id,
          purpose: 'email_verification',
          tokenHash: hashToken(verificationCode),
          expiresAt: new Date(Date.now() + codeTtlMinutes * 60 * 1000),
        },
      })

      await this.auditService.log(tx, {
        companyId: invitation.companyId,
        actorUserId: created.id,
        action: 'invitation_accepted',
        recordType: 'app_user',
        recordId: created.id,
        ip: meta.ip,
      })

      return { email: created.email, code: verificationCode, ttlMinutes: codeTtlMinutes }
    })

    await this.mailService.sendVerificationCode(email, code, ttlMinutes)

    return { email }
  }

  /** Consumes the post-accept verification code and returns the now-verified userId, ready for `SessionService.issueSessionForUser`. Public, pre-authentication — system access. */
  async verifyEmail(email: string, code: string): Promise<string> {
    return this.rls.runWithSystemAccess(async (tx) => {
      const user = await tx.user.findUnique({ where: { email } })
      if (!user) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'No account found for this email address',
        })
      }

      const authToken = await tx.authToken.findFirst({
        where: { userId: user.id, purpose: 'email_verification', consumedAt: null },
        orderBy: { createdAt: 'desc' },
      })

      if (!authToken || authToken.expiresAt < new Date()) {
        throw new BadRequestException({
          code: 'CODE_EXPIRED',
          message: 'This code has expired — request a new one',
        })
      }

      if (authToken.tokenHash !== hashToken(code)) {
        throw new BadRequestException({
          code: 'INVALID_CODE',
          message: 'Incorrect verification code',
        })
      }

      await tx.authToken.update({ where: { id: authToken.id }, data: { consumedAt: new Date() } })

      return user.id
    })
  }

  /** Public, pre-authentication — system access. */
  async resendVerificationCode(email: string): Promise<void> {
    const { userEmail, code, ttlMinutes, preferredLocale } = await this.rls.runWithSystemAccess(
      async (tx) => {
        const user = await tx.user.findUnique({ where: { email } })
        if (!user) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: 'No account found for this email address',
          })
        }

        const codeTtlMinutes = this.configService.get('EMAIL_VERIFICATION_CODE_TTL_MINUTES', {
          infer: true,
        })
        const verificationCode = generateNumericCode()

        await tx.authToken.updateMany({
          where: { userId: user.id, purpose: 'email_verification', consumedAt: null },
          data: { consumedAt: new Date() },
        })
        await tx.authToken.create({
          data: {
            id: newId(),
            userId: user.id,
            purpose: 'email_verification',
            tokenHash: hashToken(verificationCode),
            expiresAt: new Date(Date.now() + codeTtlMinutes * 60 * 1000),
          },
        })

        return {
          userEmail: user.email,
          code: verificationCode,
          ttlMinutes: codeTtlMinutes,
          preferredLocale: user.preferredLocale,
        }
      },
    )

    await this.mailService.sendVerificationCode(
      userEmail,
      code,
      ttlMinutes,
      resolveLocale(preferredLocale),
    )
  }

  private issueToken(): { plaintext: string; tokenHash: string; expiresAt: Date } {
    const plaintext = randomBytes(32).toString('hex')
    const ttlDays = this.configService.get('INVITATION_TOKEN_TTL_DAYS', { infer: true })
    return {
      plaintext,
      tokenHash: hashToken(plaintext),
      expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
    }
  }

  private async findValidByToken(tx: Prisma.TransactionClient, token: string): Promise<Invitation> {
    const invitation = await tx.invitation.findUnique({ where: { tokenHash: hashToken(token) } })
    if (!invitation) {
      throw new NotFoundException({
        code: 'INVITATION_NOT_FOUND',
        message: 'This invitation link is invalid',
      })
    }
    if (invitation.status === 'revoked') {
      throw new GoneException({
        code: 'INVITATION_REVOKED',
        message: 'This invitation has been revoked',
      })
    }
    if (invitation.status === 'accepted') {
      throw new GoneException({
        code: 'INVITATION_ALREADY_ACCEPTED',
        message: 'This invitation has already been accepted',
      })
    }
    if (invitation.status === 'expired' || invitation.expiresAt < new Date()) {
      throw new GoneException({
        code: 'INVITATION_EXPIRED',
        message: 'This invitation has expired',
      })
    }
    return invitation
  }

  private assertTenantAdmin(actor: AuthenticatedUser): void {
    if (!actor.companyId || !actor.roleKeys.includes('SYSTEM_ADMINISTRATOR')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only a system administrator can manage invitations',
      })
    }
  }

  private async sendInvitationEmail(
    invitation: Invitation,
    companyName: string,
    inviterName: string,
    plaintextToken: string,
  ): Promise<void> {
    const acceptUrl = `${this.configService.get('FRONTEND_URL', { infer: true })}/accept-invitation?token=${plaintextToken}`
    const ttlDays = this.configService.get('INVITATION_TOKEN_TTL_DAYS', { infer: true })
    const roleLabels = invitation.roleKeys.map(formatRoleLabel)

    await this.mailService.sendInvitation(
      invitation.email,
      companyName,
      inviterName,
      roleLabels,
      acceptUrl,
      ttlDays,
    )
  }
}
