import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { BatchReleaseService } from './batch-release.service'
import { ReleaseBatchDto } from './dto/release-batch.dto'

@ApiTags('quality-batch-release')
@Controller('quality/batches/:batchId/release')
export class BatchReleaseController {
  constructor(private readonly batchReleaseService: BatchReleaseService) {}

  @RequirePermissions('quality.view_all')
  @Get('readiness')
  getReadiness(@CurrentUser() user: AuthenticatedUser, @Param('batchId') batchId: string) {
    return this.batchReleaseService.getReadiness(user, batchId)
  }

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param('batchId') batchId: string) {
    return this.batchReleaseService.listForBatch(user, batchId)
  }

  @RequirePermissions('quality.manage_batch_release')
  @Post()
  release(
    @CurrentUser() user: AuthenticatedUser,
    @Param('batchId') batchId: string,
    @Body() dto: ReleaseBatchDto,
    @Req() req: Request,
  ) {
    return this.batchReleaseService.release(user, batchId, dto, { ip: req.ip })
  }
}
