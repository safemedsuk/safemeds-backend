import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { BatchRecordReviewService } from './batch-record-review.service'
import { BatchTraceabilityService } from './batch-traceability.service'
import { CreateBatchRecordReviewDto } from './dto/create-batch-record-review.dto'
import { RecordBatchDispositionDto } from './dto/record-batch-disposition.dto'

@ApiTags('quality-batch-record-review')
@Controller('quality/batch-record-reviews')
export class BatchRecordReviewController {
  constructor(private readonly batchRecordReviewService: BatchRecordReviewService) {}

  @RequirePermissions('quality.view_all')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.batchRecordReviewService.get(user, id)
  }

  @RequirePermissions('quality.review_batch_records')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBatchRecordReviewDto,
    @Req() req: Request,
  ) {
    return this.batchRecordReviewService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.review_batch_records')
  @Post(':id/disposition')
  recordDisposition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordBatchDispositionDto,
    @Req() req: Request,
  ) {
    return this.batchRecordReviewService.recordDisposition(user, id, dto, { ip: req.ip })
  }
}

@ApiTags('quality-batches')
@Controller('quality/batches')
export class QualityBatchController {
  constructor(
    private readonly batchRecordReviewService: BatchRecordReviewService,
    private readonly batchTraceabilityService: BatchTraceabilityService,
  ) {}

  @RequirePermissions('quality.view_all')
  @Get(':id/record-reviews')
  listRecordReviews(@CurrentUser() user: AuthenticatedUser, @Param('id') batchId: string) {
    return this.batchRecordReviewService.listForBatch(user, batchId)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id/traceability')
  trace(@CurrentUser() user: AuthenticatedUser, @Param('id') batchId: string) {
    return this.batchTraceabilityService.trace(user, batchId)
  }
}
