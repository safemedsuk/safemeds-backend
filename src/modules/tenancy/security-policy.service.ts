import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, SecurityPolicy } from '@prisma/client'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService, diffForAudit } from '../audit/audit.service'
import { UpdateSecurityPolicyDto } from './dto/update-security-policy.dto'

export interface RequestMeta {
  ip?: string
}

@Injectable()
export class SecurityPolicyService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Any authenticated member of the company can read its security
   * policy — every user needs to know its `minPasswordLength` when
   * setting a new password (change-password, etc.), not just admins.
   * Only `update()` below is admin-gated.
   */
  async get(actor: AuthenticatedUser): Promise<SecurityPolicy> {
    if (!actor.companyId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'No company context for this account',
      })
    }
    return this.rls.runAsCompany(actor.companyId, (tx) => this.findOrThrow(tx, actor.companyId!))
  }

  async update(
    actor: AuthenticatedUser,
    dto: UpdateSecurityPolicyDto,
    meta: RequestMeta,
  ): Promise<SecurityPolicy> {
    this.assertTenantAdmin(actor)

    return this.rls.runAsCompany(actor.companyId!, async (tx) => {
      const existing = await this.findOrThrow(tx, actor.companyId!)

      const result = await tx.securityPolicy.update({
        where: { companyId: actor.companyId! },
        data: {
          ...(dto.minPasswordLength !== undefined
            ? { minPasswordLength: dto.minPasswordLength }
            : {}),
          ...(dto.sessionTimeoutMinutes !== undefined
            ? { sessionTimeoutMinutes: dto.sessionTimeoutMinutes }
            : {}),
          ...(dto.mfaRequiredForSignatureRoles !== undefined
            ? { mfaRequiredForSignatureRoles: dto.mfaRequiredForSignatureRoles }
            : {}),
        },
      })

      const { oldValue, newValue } = diffForAudit(
        {
          minPasswordLength: existing.minPasswordLength,
          sessionTimeoutMinutes: existing.sessionTimeoutMinutes,
          mfaRequiredForSignatureRoles: existing.mfaRequiredForSignatureRoles,
        },
        {
          minPasswordLength: result.minPasswordLength,
          sessionTimeoutMinutes: result.sessionTimeoutMinutes,
          mfaRequiredForSignatureRoles: result.mfaRequiredForSignatureRoles,
        },
      )

      await this.auditService.log(tx, {
        companyId: actor.companyId,
        actorUserId: actor.sub,
        action: 'security_policy_updated',
        recordType: 'security_policy',
        recordId: existing.id,
        oldValue,
        newValue,
        ip: meta.ip,
      })

      return result
    })
  }

  private async findOrThrow(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<SecurityPolicy> {
    const policy = await tx.securityPolicy.findUnique({ where: { companyId } })
    if (!policy) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'No security policy found for this company',
      })
    }
    return policy
  }

  private assertTenantAdmin(actor: AuthenticatedUser): void {
    if (!actor.companyId || !actor.roleKeys.includes('SYSTEM_ADMINISTRATOR')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only a system administrator can manage the security policy',
      })
    }
  }
}
