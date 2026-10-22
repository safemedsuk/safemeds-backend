import {
  Body,
  Controller,
  Get,
  Param,
  ParseFilePipeBuilder,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { memoryStorage } from 'multer'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { MAX_UPLOAD_BYTES } from '../../common/upload-limits.const'
import { ComplaintService } from './complaint.service'
import { ClassifyComplaintDto } from './dto/classify-complaint.dto'
import { CreateComplaintDto } from './dto/create-complaint.dto'
import { ListComplaintsQueryDto } from './dto/list-complaints-query.dto'
import { OpenCapaForComplaintDto } from './dto/open-capa-for-complaint.dto'
import { ResolveComplaintDto } from './dto/resolve-complaint.dto'

@ApiTags('quality-complaints')
@Controller('quality/complaints')
export class ComplaintController {
  constructor(private readonly complaintService: ComplaintService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListComplaintsQueryDto) {
    return this.complaintService.list(user, query)
  }

  @RequirePermissions('quality.view_all')
  @Get('resolution-time-kpi')
  resolutionTimeKpi(@CurrentUser() user: AuthenticatedUser) {
    return this.complaintService.resolutionTimeKpi(user)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.complaintService.get(user, id)
  }

  @RequirePermissions('quality.log_deviation')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateComplaintDto,
    @Req() req: Request,
  ) {
    return this.complaintService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.log_deviation')
  @Post(':id/classify')
  classify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ClassifyComplaintDto,
    @Req() req: Request,
  ) {
    return this.complaintService.classify(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.close_capa')
  @Post(':id/resolve')
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResolveComplaintDto,
    @Req() req: Request,
  ) {
    return this.complaintService.resolve(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_capa')
  @Post(':id/capa')
  openCapaForComplaint(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: OpenCapaForComplaintDto,
    @Req() req: Request,
  ) {
    return this.complaintService.openCapaForComplaint(user, id, dto, { ip: req.ip })
  }

  /** Pass A2 (item 4d) — a substantiating document; resolving the complaint requires at least one. */
  @RequirePermissions('quality.log_deviation')
  @Post(':id/substantiation')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  uploadSubstantiation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.complaintService.uploadSubstantiation(
      user,
      id,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { ip: req.ip },
    )
  }
}
