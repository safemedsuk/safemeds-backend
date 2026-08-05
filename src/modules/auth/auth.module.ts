import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'

import { EnvConfig } from '../../config/env.validation'
import { AuditModule } from '../audit/audit.module'
import { DocumentsModule } from '../documents/documents.module'
import { RolesModule } from '../roles/roles.module'
import { AuthController } from './auth.controller'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { MailService } from './services/mail.service'
import { MfaService } from './services/mfa.service'
import { MfaPendingTokenService } from './services/mfa-pending-token.service'
import { PasswordService } from './services/password.service'
import { PasswordLifecycleService } from './services/password-lifecycle.service'
import { ReauthService } from './services/reauth.service'
import { RegistrationService } from './services/registration.service'
import { SessionService } from './services/session.service'
import { SessionActivityService } from './services/session-activity.service'
import { SignatureTokenService } from './services/signature-token.service'
import { TokenService } from './services/token.service'
import { JwtStrategy } from './strategies/jwt.strategy'

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvConfig, true>) => ({
        secret: configService.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { expiresIn: configService.get('JWT_ACCESS_EXPIRES_IN', { infer: true }) },
      }),
    }),
    DocumentsModule,
    AuditModule,
    RolesModule,
  ],
  controllers: [AuthController],
  providers: [
    PasswordService,
    MailService,
    TokenService,
    RegistrationService,
    SessionService,
    SessionActivityService,
    ReauthService,
    SignatureTokenService,
    MfaService,
    MfaPendingTokenService,
    PasswordLifecycleService,
    JwtStrategy,
    JwtAuthGuard,
  ],
  exports: [
    JwtAuthGuard,
    MailService,
    TokenService,
    PasswordService,
    SessionService,
    SignatureTokenService,
  ],
})
export class AuthModule {}
