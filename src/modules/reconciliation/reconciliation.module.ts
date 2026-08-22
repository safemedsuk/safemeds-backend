import { Module } from '@nestjs/common'

import { AuditModule } from '../audit/audit.module'
import { RolesModule } from '../roles/roles.module'
import { DistributorController } from './distributor.controller'
import { DistributorService } from './distributor.service'
import { PlatformDistributorsController } from './platform-distributors.controller'
import { ReconciliationController } from './reconciliation.controller'
import { ReconciliationService } from './reconciliation.service'

@Module({
  imports: [AuditModule, RolesModule],
  controllers: [DistributorController, PlatformDistributorsController, ReconciliationController],
  providers: [DistributorService, ReconciliationService],
  exports: [DistributorService, ReconciliationService],
})
export class ReconciliationModule {}
