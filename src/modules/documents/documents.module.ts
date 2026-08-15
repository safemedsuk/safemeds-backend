import { Module } from '@nestjs/common'

import { AuditModule } from '../audit/audit.module'
import { DocumentsController } from './documents.controller'
import { DocumentsService } from './documents.service'
import { StorageService } from './storage.service'

@Module({
  imports: [AuditModule],
  controllers: [DocumentsController],
  providers: [StorageService, DocumentsService],
  // `DocumentsService` exported for `WhatsAppIntakeModule` (Stage 3.4),
  // which reuses `uploadDirectSystem()` for the optional
  // packaging-photo attachment rather than duplicating the upload path.
  exports: [StorageService, DocumentsService],
})
export class DocumentsModule {}
