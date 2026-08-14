import { Module } from '@nestjs/common'

import { CountryConfigModule } from '../country-config/country-config.module'
import { CountriesController } from './countries.controller'
import { CountriesService } from './countries.service'
import { ReportTypesController } from './report-types.controller'
import { ReportTypesService } from './report-types.service'

@Module({
  imports: [CountryConfigModule],
  controllers: [CountriesController, ReportTypesController],
  providers: [CountriesService, ReportTypesService],
})
export class CountriesModule {}
