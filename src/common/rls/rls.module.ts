import { forwardRef, Global, Module } from '@nestjs/common'

import { AuditModule } from '../../modules/audit/audit.module'
import { RlsService } from './rls.service'

@Global()
@Module({
  imports: [forwardRef(() => AuditModule)],
  providers: [RlsService],
  exports: [RlsService],
})
export class RlsModule {}
