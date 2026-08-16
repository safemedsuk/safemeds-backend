import { Module } from '@nestjs/common'

import { AuditModule } from '../audit/audit.module'
import { CapaController } from './capa.controller'
import { CapaService } from './capa.service'
import { InternalAuditController } from './internal-audit.controller'
import { InternalAuditService } from './internal-audit.service'

@Module({
  imports: [AuditModule],
  controllers: [InternalAuditController, CapaController],
  providers: [InternalAuditService, CapaService],
  exports: [InternalAuditService, CapaService],
})
export class InternalAuditModule {}
