import { Module, ValidationPipe } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import type { IncomingMessage } from 'http'
import { LoggerModule } from 'nestjs-pino'

import { EncryptionModule } from './common/encryption/encryption.module'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'
import { PermissionsGuard } from './common/guards/permissions.guard'
import { TransformInterceptor } from './common/interceptors/transform.interceptor'
import { RequestWithId } from './common/middleware/request-id.middleware'
import { RedisModule } from './common/redis/redis.module'
import { RlsModule } from './common/rls/rls.module'
import { EnvConfig, validateEnv } from './config/env.validation'
import { HealthModule } from './health/health.module'
import { AuditModule } from './modules/audit/audit.module'
import { AuthModule } from './modules/auth/auth.module'
import { CsrfGuard } from './modules/auth/guards/csrf.guard'
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard'
import { BulkImportModule } from './modules/bulk-import/bulk-import.module'
import { ConsentModule } from './modules/consent/consent.module'
import { ContactTestingModule } from './modules/contact-testing/contact-testing.module'
import { CountriesModule } from './modules/countries/countries.module'
import { DataPrivacyModule } from './modules/data-privacy/data-privacy.module'
import { DocumentsModule } from './modules/documents/documents.module'
import { EmailIntakeModule } from './modules/email-intake/email-intake.module'
import { EntitlementsModule } from './modules/entitlements/entitlements.module'
import { GovernanceModule } from './modules/governance/governance.module'
import { InternalAuditModule } from './modules/internal-audit/internal-audit.module'
import { MasterDataModule } from './modules/master-data/master-data.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { PlatformModule } from './modules/platform/platform.module'
import { PsmfModule } from './modules/psmf/psmf.module'
import { PublicReportingModule } from './modules/public-reporting/public-reporting.module'
import { PvModule } from './modules/pv/pv.module'
import { QppvNominationModule } from './modules/qppv-nomination/qppv-nomination.module'
import { QualityModule } from './modules/quality/quality.module'
import { RbacAdminModule } from './modules/rbac-admin/rbac-admin.module'
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module'
import { RecordVersioningModule } from './modules/record-versioning/record-versioning.module'
import { RegulatoryModule } from './modules/regulatory/regulatory.module'
import { RegulatoryAuthoritiesModule } from './modules/regulatory-authorities/regulatory-authorities.module'
import { ReportBuilderModule } from './modules/report-builder/report-builder.module'
import { ReportingModule } from './modules/reporting/reporting.module'
import { ReportsModule } from './modules/reports/reports.module'
import { RolesModule } from './modules/roles/roles.module'
import { SdeaModule } from './modules/sdea/sdea.module'
import { SignaturesModule } from './modules/signatures/signatures.module'
import { TasksModule } from './modules/tasks/tasks.module'
import { TenancyModule } from './modules/tenancy/tenancy.module'
import { TrainingModule } from './modules/training/training.module'
import { WhatsAppIntakeModule } from './modules/whatsapp-intake/whatsapp-intake.module'
import { WorkflowModule } from './modules/workflow/workflow.module'
import { PrismaModule } from './prisma/prisma.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvConfig, true>) => ({
        pinoHttp: {
          level: configService.get('LOG_LEVEL', { infer: true }),
          genReqId: (req: IncomingMessage) => (req as RequestWithId).id ?? '',
          customProps: (req: IncomingMessage) => ({ requestId: (req as RequestWithId).id }),
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
            remove: true,
          },
          transport:
            configService.get('NODE_ENV', { infer: true }) !== 'production'
              ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
              : undefined,
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvConfig, true>) => ({
        throttlers: [
          {
            ttl: configService.get('THROTTLE_TTL_SECONDS', { infer: true }) * 1000,
            limit: configService.get('THROTTLE_LIMIT', { infer: true }),
          },
        ],
      }),
    }),
    PrismaModule,
    RedisModule,
    RlsModule,
    HealthModule,
    AuditModule,
    DocumentsModule,
    CountriesModule,
    RegulatoryModule,
    RegulatoryAuthoritiesModule,
    AuthModule,
    PlatformModule,
    RolesModule,
    TenancyModule,
    SignaturesModule,
    WorkflowModule,
    MasterDataModule,
    TasksModule,
    NotificationsModule,
    // VigiCloud Phase 11, Stage 0 — cross-cutting base-engine primitives.
    EncryptionModule,
    ConsentModule,
    DataPrivacyModule,
    RecordVersioningModule,
    EntitlementsModule,
    BulkImportModule,
    ReportsModule,
    // VigiCloud Phase 11, Stage 1 — core PV domain schema.
    PvModule,
    // VigiCloud Phase 11, Stage 3 — multi-channel case intake.
    PublicReportingModule,
    EmailIntakeModule,
    WhatsAppIntakeModule,
    // VigiCloud Phase 11, Stage 15 — reconciliation & contact testing.
    ReconciliationModule,
    ContactTestingModule,
    // VigiCloud Phase 11, Stage 16 — governance & audit module.
    PsmfModule,
    GovernanceModule,
    InternalAuditModule,
    QppvNominationModule,
    SdeaModule,
    // QualCloud (Phase 13), Stage 0 — Foundation Layer.
    QualityModule,
    TrainingModule,
    // VigiCloud Phase 11, Stage 18 — reporting & periodic outputs.
    ReportingModule,
    // Real-usage request, 11 Sep 2026 — the self-service report builder.
    ReportBuilderModule,
    // Admin Configuration Console — country config/RBAC live-editable
    // instead of seed-file-only.
    RbacAdminModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
