import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CompanyRegistration } from '@prisma/client'
import { createHash, randomInt } from 'crypto'

import { newId } from '../../../common/id'
import { RlsService } from '../../../common/rls/rls.service'
import { EnvConfig } from '../../../config/env.validation'
import { PrismaService } from '../../../prisma/prisma.service'
import { StorageService } from '../../documents/storage.service'
import { RegisterCompanyDto } from '../dto/register-company.dto'
import { ResendCodeDto } from '../dto/resend-code.dto'
import { VerifyEmailDto } from '../dto/verify-email.dto'
import { MailService } from './mail.service'
import { PasswordService } from './password.service'

const ALLOWED_LICENCE_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png'])

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

function generateNumericCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsService,
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly passwordService: PasswordService,
    private readonly mailService: MailService,
    private readonly storageService: StorageService,
  ) {}

  async registerCompany(dto: RegisterCompanyDto): Promise<CompanyRegistration> {
    this.passwordService.assertPolicy(dto.adminPassword, {
      fullName: dto.adminFullName,
      companyName: dto.companyName,
    })

    const country = await this.prisma.country.findUnique({ where: { id: dto.countryId } })
    if (!country) {
      throw new BadRequestException({ code: 'INVALID_COUNTRY', message: 'Unknown country' })
    }

    // Global email uniqueness is a platform invariant, not a tenant one —
    // this check must see across every company, hence system access.
    const existingUser = await this.rls.runWithSystemAccess((tx) =>
      tx.user.findUnique({ where: { email: dto.adminEmail } }),
    )
    if (existingUser) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'An account already exists for this email address',
      })
    }

    const existingRegistration = await this.prisma.companyRegistration.findFirst({
      where: {
        adminEmail: dto.adminEmail,
        status: { in: ['pending_verification', 'under_review'] },
      },
    })
    if (existingRegistration) {
      throw new ConflictException({
        code: 'REGISTRATION_IN_PROGRESS',
        message: 'A registration is already in progress for this email address',
      })
    }

    const adminPasswordHash = await this.passwordService.hash(dto.adminPassword)
    const referenceNumber = await this.generateUniqueReferenceNumber()
    const code = generateNumericCode()

    const registration = await this.prisma.companyRegistration.create({
      data: {
        id: newId(),
        referenceNumber,
        companyName: dto.companyName,
        companyType: dto.companyType,
        countryId: dto.countryId,
        companyEmail: dto.companyEmail,
        licenceNumber: dto.licenceNumber,
        adminFullName: dto.adminFullName,
        adminEmail: dto.adminEmail,
        adminPhone: dto.adminPhone,
        adminPasswordHash,
        verificationCodeHash: hashCode(code),
        verificationCodeExpiresAt: this.codeExpiresAt(),
        verificationLastSentAt: new Date(),
      },
    })

    await this.mailService.sendVerificationCode(
      dto.adminEmail,
      code,
      this.configService.get('EMAIL_VERIFICATION_CODE_TTL_MINUTES', { infer: true }),
    )

    return registration
  }

  async uploadLicence(
    referenceNumber: string,
    file: { buffer: Buffer; originalname: string },
  ): Promise<{ key: string; sha256: string }> {
    const registration = await this.findByReference(referenceNumber)

    if (registration.status !== 'pending_verification') {
      throw new BadRequestException({
        code: 'REGISTRATION_NOT_EDITABLE',
        message: 'This registration can no longer accept a licence upload',
      })
    }

    const maxSizeBytes =
      this.configService.get('UPLOAD_MAX_FILE_SIZE_MB', { infer: true }) * 1024 * 1024
    if (file.buffer.byteLength > maxSizeBytes) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: 'File must be 10MB or smaller',
      })
    }

    // `file-type` is ESM-only; dynamic import works regardless of the
    // Node version's require(esm) support (stable only since Node 22.12).
    const { fileTypeFromBuffer } = await import('file-type')
    const detected = await fileTypeFromBuffer(file.buffer)
    if (!detected || !ALLOWED_LICENCE_MIME_TYPES.has(detected.mime)) {
      throw new BadRequestException({
        code: 'INVALID_FILE_TYPE',
        message: 'File must be a PDF, JPG, or PNG (verified by content, not just extension)',
      })
    }

    const key = `registrations/${referenceNumber}/licence.${detected.ext}`
    const result = await this.storageService.putObject(key, file.buffer, detected.mime)

    await this.prisma.companyRegistration.update({
      where: { id: registration.id },
      data: { licenceDocKey: result.key, licenceDocSha256: result.sha256 },
    })

    return { key: result.key, sha256: result.sha256 }
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<CompanyRegistration> {
    const registration = await this.prisma.companyRegistration.findFirst({
      where: { adminEmail: dto.email, status: 'pending_verification' },
      orderBy: { createdAt: 'desc' },
    })

    if (!registration) {
      throw new NotFoundException({
        code: 'NO_PENDING_VERIFICATION',
        message: 'No pending verification found for this email address',
      })
    }

    const maxAttempts = this.configService.get('EMAIL_VERIFICATION_MAX_ATTEMPTS', { infer: true })
    if (registration.verificationAttempts >= maxAttempts) {
      throw new BadRequestException({
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Too many incorrect attempts. Request a new code.',
      })
    }

    if (
      !registration.verificationCodeExpiresAt ||
      registration.verificationCodeExpiresAt < new Date()
    ) {
      throw new BadRequestException({ code: 'CODE_EXPIRED', message: 'This code has expired' })
    }

    if (registration.verificationCodeHash !== hashCode(dto.code)) {
      const attemptsRemaining = maxAttempts - (registration.verificationAttempts + 1)
      await this.prisma.companyRegistration.update({
        where: { id: registration.id },
        data: { verificationAttempts: { increment: 1 } },
      })
      throw new BadRequestException({
        code: 'INVALID_CODE',
        message: 'Incorrect verification code',
        attemptsRemaining,
      })
    }

    return this.prisma.companyRegistration.update({
      where: { id: registration.id },
      data: { status: 'under_review' },
    })
  }

  async resendCode(dto: ResendCodeDto): Promise<void> {
    const registration = await this.prisma.companyRegistration.findFirst({
      where: { adminEmail: dto.email, status: 'pending_verification' },
      orderBy: { createdAt: 'desc' },
    })

    if (!registration) {
      throw new NotFoundException({
        code: 'NO_PENDING_VERIFICATION',
        message: 'No pending verification found for this email address',
      })
    }

    const cooldownSeconds = this.configService.get('EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS', {
      infer: true,
    })
    if (registration.verificationLastSentAt) {
      const elapsedMs = Date.now() - registration.verificationLastSentAt.getTime()
      if (elapsedMs < cooldownSeconds * 1000) {
        const retryAfterSeconds = Math.ceil((cooldownSeconds * 1000 - elapsedMs) / 1000)
        throw new HttpException(
          {
            code: 'RESEND_COOLDOWN',
            message: 'Please wait before requesting another code',
            retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }
    }

    const code = generateNumericCode()
    await this.prisma.companyRegistration.update({
      where: { id: registration.id },
      data: {
        verificationCodeHash: hashCode(code),
        verificationCodeExpiresAt: this.codeExpiresAt(),
        verificationAttempts: 0,
        verificationLastSentAt: new Date(),
      },
    })

    await this.mailService.sendVerificationCode(
      dto.email,
      code,
      this.configService.get('EMAIL_VERIFICATION_CODE_TTL_MINUTES', { infer: true }),
    )
  }

  async findByReference(referenceNumber: string): Promise<CompanyRegistration> {
    const registration = await this.prisma.companyRegistration.findUnique({
      where: { referenceNumber },
    })
    if (!registration) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Registration not found' })
    }
    return registration
  }

  private codeExpiresAt(): Date {
    const ttlMinutes = this.configService.get('EMAIL_VERIFICATION_CODE_TTL_MINUTES', {
      infer: true,
    })
    return new Date(Date.now() + ttlMinutes * 60 * 1000)
  }

  private async generateUniqueReferenceNumber(): Promise<string> {
    const year = new Date().getFullYear()

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const suffix = randomInt(0, 100_000).toString().padStart(5, '0')
      const candidate = `REG-${year}-${suffix}`
      const existing = await this.prisma.companyRegistration.findUnique({
        where: { referenceNumber: candidate },
      })
      if (!existing) {
        return candidate
      }
    }

    throw new Error('Failed to generate a unique registration reference number')
  }
}
