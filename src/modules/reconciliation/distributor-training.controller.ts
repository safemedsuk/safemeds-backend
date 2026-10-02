import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { DistributorTrainingService } from './distributor-training.service'
import { AttachDistributorTrainingCertificateDto } from './dto/attach-distributor-training-certificate.dto'
import { CreateDistributorTrainingRecordDto } from './dto/create-distributor-training-record.dto'
import { ListDistributorTrainingRecordsQueryDto } from './dto/list-distributor-training-records-query.dto'

/** Real-usage request, 22 Sep 2026 (item 6) — gated by the same `reconciliation.view`/`reconciliation.manage` permissions as the rest of the Reconciliation domain, per the request's own "SDEA has reconciliation and training" framing — not the separate `training.*` permissions, which are for SafeMeds' own staff (`TrainingRecordService`), a different population entirely. */
@ApiTags('reconciliation')
@Controller('distributor-training-records')
export class DistributorTrainingController {
  constructor(private readonly distributorTrainingService: DistributorTrainingService) {}

  @RequirePermissions('reconciliation.manage')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDistributorTrainingRecordDto,
    @Req() req: Request,
  ) {
    return this.distributorTrainingService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('reconciliation.manage')
  @Post(':id/certificate')
  attachCertificate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AttachDistributorTrainingCertificateDto,
    @Req() req: Request,
  ) {
    return this.distributorTrainingService.attachCertificate(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('reconciliation.view')
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListDistributorTrainingRecordsQueryDto,
  ) {
    return this.distributorTrainingService.list(user, query)
  }

  @RequirePermissions('reconciliation.view')
  @Get('status/:distributorId')
  getStatusForDistributor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('distributorId') distributorId: string,
  ) {
    return this.distributorTrainingService.getStatusForDistributor(user, distributorId)
  }

  @RequirePermissions('reconciliation.view')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.distributorTrainingService.get(user, id)
  }
}
