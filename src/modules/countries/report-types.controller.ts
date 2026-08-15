import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { ReportTypesService } from './report-types.service'

@ApiTags('report-types')
@Controller('report-types')
export class ReportTypesController {
  constructor(private readonly reportTypesService: ReportTypesService) {}

  /** Open to any authenticated user — catalog metadata (what kind of report exists per module), not sensitive, same treatment as the role catalog. */
  @Get()
  list(@Query('moduleKey') moduleKey?: string) {
    return this.reportTypesService.list(moduleKey)
  }
}
