import { Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { QualityMetricsQueryDto } from './dto/quality-metrics-query.dto'
import { QualityMetricsService } from './quality-metrics.service'
import { QualityTrendDetectionService } from './quality-trend-detection.service'

function resolvePeriod(query: QualityMetricsQueryDto): { from: Date; to: Date } {
  const to = query.to ? new Date(query.to) : new Date()
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000)
  return { from, to }
}

/**
 * QualCloud (Phase 13) Stage 8 — live metrics + trend flags. Reads are
 * gated by `quality.view_metrics` (both quality roles); acknowledging a
 * flag is a `quality.manage_management_review`-only leadership action.
 */
@ApiTags('quality-metrics')
@Controller('quality-metrics')
@RequirePermissions('quality.view_metrics')
export class QualityMetricsController {
  constructor(
    private readonly metricsService: QualityMetricsService,
    private readonly trendDetectionService: QualityTrendDetectionService,
  ) {}

  @Get()
  get(@CurrentUser() actor: AuthenticatedUser, @Query() query: QualityMetricsQueryDto) {
    return this.metricsService.compute(actor, resolvePeriod(query))
  }

  /** Runs the exact same scan the daily job runs — an on-demand "recompute trends now," the same pattern `SignalDetectionService.scanCompany()`'s own "Run Detection Now" button already established. */
  @Post('trend-flags/run-now')
  runDetectionNow() {
    return this.trendDetectionService.scanAndFlag()
  }

  @Get('trend-flags')
  listTrendFlags(@CurrentUser() actor: AuthenticatedUser) {
    return this.trendDetectionService.list(actor)
  }

  @RequirePermissions('quality.manage_management_review')
  @Patch('trend-flags/:id/acknowledge')
  acknowledge(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.trendDetectionService.acknowledge(actor, id, { ip: req.ip })
  }
}
