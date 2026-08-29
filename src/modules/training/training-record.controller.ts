import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { AttachTrainingCertificateDto } from './dto/attach-training-certificate.dto'
import { CreateTrainingRecordDto } from './dto/create-training-record.dto'
import { ListTrainingRecordsQueryDto } from './dto/list-training-records-query.dto'
import { TrainingRecordService } from './training-record.service'

@ApiTags('training')
@Controller('training-records')
export class TrainingRecordController {
  constructor(private readonly trainingRecordService: TrainingRecordService) {}

  @RequirePermissions('training.manage')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTrainingRecordDto,
    @Req() req: Request,
  ) {
    return this.trainingRecordService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('training.manage')
  @Post(':id/certificate')
  attachCertificate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AttachTrainingCertificateDto,
    @Req() req: Request,
  ) {
    return this.trainingRecordService.attachCertificate(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('training.view')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListTrainingRecordsQueryDto) {
    return this.trainingRecordService.list(user, query)
  }

  @RequirePermissions('training.view')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.trainingRecordService.get(user, id)
  }
}
