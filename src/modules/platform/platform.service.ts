import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CompanyRegistration } from '@prisma/client'

import { newId } from '../../common/id'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { EnvConfig } from '../../config/env.validation'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { MailService } from '../auth/services/mail.service'
import { StorageService } from '../documents/storage.service'
import { ListRegistrationsQueryDto } from './dto/list-registrations-query.dto'
import { computeRegistrationFlags, RegistrationFlags } from './registration-flags.util'

type SafeCompanyRegistration = Omit<
  CompanyRegistration,
  'adminPasswordHash' | 'verificationCodeHash'
>

export type RegistrationListItem = SafeCompanyRegistration & RegistrationFlags

function toSafeRegistration(registration: CompanyRegistration): SafeCompanyRegistration {
  const safe: Partial<CompanyRegistration> = { ...registration }
  delete safe.adminPasswordHash
  delete safe.verificationCodeHash
  return safe as SafeCompanyRegistration
}

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsService,
    private readonly storageService: StorageService,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  async listRegistrations(
    query: ListRegistrationsQueryDto,
  ): Promise<PaginatedResult<RegistrationListItem>> {
    const where = query.status ? { status: query.status } : {}

    const [rows, total] = await Promise.all([
      this.prisma.companyRegistration.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.companyRegistration.count({ where }),
    ])

    const items = rows.map((row) => ({
      ...toSafeRegistration(row),
      ...computeRegistrationFlags(row.companyName, row.adminEmail),
    }))

    return paginate(items, total, query)
  }

  async getRegistration(
    id: string,
  ): Promise<RegistrationListItem & { licenceViewUrl: string | null }> {
    const registration = await this.prisma.companyRegistration.findUnique({ where: { id } })
    if (!registration) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Registration not found' })
    }

    const licenceViewUrl = registration.licenceDocKey
      ? await this.storageService.presignDownload(
          registration.licenceDocKey,
          this.configService.get('PRESIGNED_DOWNLOAD_TTL_SECONDS', { infer: true }),
        )
      : null

    return {
      ...toSafeRegistration(registration),
      ...computeRegistrationFlags(registration.companyName, registration.adminEmail),
      licenceViewUrl,
    }
  }

  async approve(id: string, reviewerId: string): Promise<SafeCompanyRegistration> {
    const registration = await this.prisma.companyRegistration.findUnique({ where: { id } })
    if (!registration) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Registration not found' })
    }
    if (registration.status !== 'under_review') {
      throw new BadRequestException({
        code: 'REGISTRATION_NOT_REVIEWABLE',
        message: 'This registration is not awaiting review',
      })
    }

    const updated = await this.rls.runWithPlatformAccess(
      reviewerId,
      `Approved company registration ${registration.referenceNumber}`,
      async (tx) => {
        const companyId = newId()
        await tx.company.create({
          data: {
            id: companyId,
            name: registration.companyName,
            companyType: registration.companyType,
            homeCountryId: registration.countryId,
            // testing-correction-explanation.md decision #4 — carried from
            // the registration wizard; null only for the handful of real
            // pending registrations that predate this field (see
            // `CompanyRegistration.companyEmail`'s own schema doc comment).
            regulatoryContactEmail: registration.companyEmail,
            status: 'active',
          },
        })

        const userId = newId()
        await tx.user.create({
          data: {
            id: userId,
            companyId,
            email: registration.adminEmail,
            fullName: registration.adminFullName,
            passwordHash: registration.adminPasswordHash,
            roleKeys: ['SYSTEM_ADMINISTRATOR'],
          },
        })

        await tx.securityPolicy.create({
          data: { id: newId(), companyId },
        })

        // A newly-approved company always operates in its own home country
        // at minimum — without this, Country Rules had no way to show that
        // market's config until someone remembered to add it by hand via
        // Company Profile, which nothing prompts a fresh admin to do.
        await tx.companyMarket.create({
          data: { companyId, countryId: registration.countryId },
        })

        const result = await tx.companyRegistration.update({
          where: { id },
          data: { status: 'approved', companyId, reviewedBy: reviewerId, decidedAt: new Date() },
        })

        await this.auditService.log(tx, {
          companyId,
          actorUserId: reviewerId,
          action: 'registration_approved',
          recordType: 'company_registration',
          recordId: id,
          oldValue: { status: registration.status },
          newValue: { status: 'approved', companyId },
        })

        await this.auditService.log(tx, {
          companyId,
          actorUserId: reviewerId,
          action: 'user_created',
          recordType: 'app_user',
          recordId: userId,
          newValue: { email: registration.adminEmail, roleKeys: ['SYSTEM_ADMINISTRATOR'] },
        })

        return result
      },
    )

    const loginUrl = `${this.configService.get('FRONTEND_URL', { infer: true })}/login`
    await this.mailService.sendRegistrationApproved(
      registration.adminEmail,
      registration.companyName,
      loginUrl,
    )

    return toSafeRegistration(updated)
  }

  async reject(id: string, reviewerId: string, reason: string): Promise<SafeCompanyRegistration> {
    const registration = await this.prisma.companyRegistration.findUnique({ where: { id } })
    if (!registration) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Registration not found' })
    }
    if (registration.status !== 'under_review') {
      throw new BadRequestException({
        code: 'REGISTRATION_NOT_REVIEWABLE',
        message: 'This registration is not awaiting review',
      })
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.companyRegistration.update({
        where: { id },
        data: {
          status: 'rejected',
          reviewedBy: reviewerId,
          decidedAt: new Date(),
          rejectionReason: reason,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: reviewerId,
        action: 'registration_rejected',
        recordType: 'company_registration',
        recordId: id,
        oldValue: { status: registration.status },
        newValue: { status: 'rejected', reason },
      })

      return result
    })

    const registerUrl = `${this.configService.get('FRONTEND_URL', { infer: true })}/register`
    await this.mailService.sendRegistrationRejected(
      registration.adminEmail,
      registration.companyName,
      reason,
      registerUrl,
    )

    return toSafeRegistration(updated)
  }
}
