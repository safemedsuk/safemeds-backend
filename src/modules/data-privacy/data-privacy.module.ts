import { Module } from '@nestjs/common'

import { AuditModule } from '../audit/audit.module'
import { BreachDetectionService } from './breach-detection.service'
import { DataSubjectRequestController } from './data-subject-request.controller'
import { DataSubjectRequestService } from './data-subject-request.service'

@Module({
  imports: [AuditModule],
  controllers: [DataSubjectRequestController],
  providers: [DataSubjectRequestService, BreachDetectionService],
  exports: [DataSubjectRequestService, BreachDetectionService],
})
export class DataPrivacyModule {}
