import { Module } from '@nestjs/common'

import { AuditModule } from '../audit/audit.module'
import { DocumentsModule } from '../documents/documents.module'
import { PsmfController } from './psmf.controller'
import { PsmfService } from './psmf.service'
import { PsmfPdfService } from './psmf-pdf.service'

@Module({
  imports: [AuditModule, DocumentsModule],
  controllers: [PsmfController],
  providers: [PsmfService, PsmfPdfService],
  exports: [PsmfService],
})
export class PsmfModule {}
