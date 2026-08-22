import { Controller, Get, Param, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ListRecordVersionsQueryDto } from './dto/list-record-versions-query.dto'
import { RecordVersioningService } from './record-versioning.service'

/** Read-only — see RecordVersioningService's doc comment for why there is no write endpoint here. */
@ApiTags('records')
@Controller('records/:recordType/:recordId/versions')
@RequirePermissions('records.view_all')
export class RecordVersioningController {
  constructor(private readonly recordVersioningService: RecordVersioningService) {}

  @Get()
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('recordType') recordType: string,
    @Param('recordId') recordId: string,
    @Query() query: ListRecordVersionsQueryDto,
  ) {
    return this.recordVersioningService.history(user, recordType, recordId, query)
  }
}
