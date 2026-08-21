import { Module } from '@nestjs/common'

import { AuditModule } from '../audit/audit.module'
import { DocumentsModule } from '../documents/documents.module'
import { QppvNominationController } from './qppv-nomination.controller'
import { QppvNominationService } from './qppv-nomination.service'
import { QppvNominationPdfService } from './qppv-nomination-pdf.service'

@Module({
  imports: [AuditModule, DocumentsModule],
  controllers: [QppvNominationController],
  providers: [QppvNominationService, QppvNominationPdfService],
  exports: [QppvNominationService],
})
export class QppvNominationModule {}
