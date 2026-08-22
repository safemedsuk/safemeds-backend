import { Module } from '@nestjs/common'

import { AuditModule } from '../audit/audit.module'
import { RecordVersioningController } from './record-versioning.controller'
import { RecordVersioningService } from './record-versioning.service'

@Module({
  imports: [AuditModule],
  controllers: [RecordVersioningController],
  providers: [RecordVersioningService],
  exports: [RecordVersioningService],
})
export class RecordVersioningModule {}
