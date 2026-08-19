import { Module } from '@nestjs/common'

import { HealthModule } from '../../health/health.module'
import { AuditModule } from '../audit/audit.module'
import { AuthModule } from '../auth/auth.module'
import { DocumentsModule } from '../documents/documents.module'
import { EntitlementsModule } from '../entitlements/entitlements.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { WorkflowModule } from '../workflow/workflow.module'
import { PlatformController } from './platform.controller'
import { PlatformGuard } from './platform.guard'
import { PlatformService } from './platform.service'
import { PlatformDashboardController } from './platform-dashboard.controller'
import { PlatformDashboardService } from './platform-dashboard.service'
import { PlatformEntitlementsController } from './platform-entitlements.controller'
import { PlatformOpsController } from './platform-ops.controller'

@Module({
  imports: [
    AuditModule,
    AuthModule,
    DocumentsModule,
    WorkflowModule,
    NotificationsModule,
    HealthModule,
    EntitlementsModule,
  ],
  controllers: [
    PlatformController,
    PlatformOpsController,
    PlatformDashboardController,
    PlatformEntitlementsController,
  ],
  providers: [PlatformService, PlatformGuard, PlatformDashboardService],
})
export class PlatformModule {}
