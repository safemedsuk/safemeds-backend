import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { DocumentsModule } from '../documents/documents.module'
import { PvModule } from '../pv/pv.module'
import { QualityModule } from '../quality/quality.module'
import { PublicReportingController } from './public-reporting.controller'
import { PublicReportingService } from './public-reporting.service'

@Module({
  imports: [AuthModule, PvModule, DocumentsModule, QualityModule],
  controllers: [PublicReportingController],
  providers: [PublicReportingService],
})
export class PublicReportingModule {}
