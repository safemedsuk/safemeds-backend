import { Module } from '@nestjs/common'

import { AuditModule } from '../audit/audit.module'
import { AuthModule } from '../auth/auth.module'
import { SignatureService } from './signature.service'
import { SignaturesController } from './signatures.controller'

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [SignaturesController],
  providers: [SignatureService],
  exports: [SignatureService],
})
export class SignaturesModule {}
