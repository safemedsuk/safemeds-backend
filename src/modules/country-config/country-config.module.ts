import { Module } from '@nestjs/common'

import { AuditModule } from '../audit/audit.module'
import { CountryConfigController } from './country-config.controller'
import { CountryConfigService } from './country-config.service'
import { RuleResolutionService } from './rule-resolution.service'

@Module({
  imports: [AuditModule],
  controllers: [CountryConfigController],
  providers: [CountryConfigService, RuleResolutionService],
  exports: [CountryConfigService, RuleResolutionService],
})
export class CountryConfigModule {}
