import { Module } from '@nestjs/common'

import { AuditModule } from '../audit/audit.module'
import { ConsentController } from './consent.controller'
import { ConsentService } from './consent.service'

@Module({
  imports: [AuditModule],
  controllers: [ConsentController],
  providers: [ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}
