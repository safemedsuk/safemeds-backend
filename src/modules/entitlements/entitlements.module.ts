import { Module } from '@nestjs/common'

import { AuditModule } from '../audit/audit.module'
import { EntitlementGuard } from './entitlement.guard'
import { EntitlementsController } from './entitlements.controller'
import { EntitlementsService } from './entitlements.service'

@Module({
  imports: [AuditModule],
  controllers: [EntitlementsController],
  providers: [EntitlementsService, EntitlementGuard],
  exports: [EntitlementsService, EntitlementGuard],
})
export class EntitlementsModule {}
