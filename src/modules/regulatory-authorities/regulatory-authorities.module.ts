import { Module } from '@nestjs/common'

import { AuditModule } from '../audit/audit.module'
import { DocumentsModule } from '../documents/documents.module'
import { RegulatoryAuthoritiesController } from './regulatory-authorities.controller'
import { RegulatoryAuthoritiesService } from './regulatory-authorities.service'

@Module({
  imports: [AuditModule, DocumentsModule],
  controllers: [RegulatoryAuthoritiesController],
  providers: [RegulatoryAuthoritiesService],
  exports: [RegulatoryAuthoritiesService],
})
export class RegulatoryAuthoritiesModule {}
