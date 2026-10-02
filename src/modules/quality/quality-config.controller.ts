import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { SEVERITY_DEFINITIONS } from './severity-definitions.const'

@ApiTags('quality-config')
@Controller('quality/config')
export class QualityConfigController {
  @RequirePermissions('quality.view_all')
  @Get('severity-definitions')
  getSeverityDefinitions() {
    return SEVERITY_DEFINITIONS
  }
}
