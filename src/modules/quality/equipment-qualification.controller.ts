import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { ParseFilePipeBuilder } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { memoryStorage } from 'multer'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { MAX_UPLOAD_BYTES } from '../../common/upload-limits.const'
import {
  CreateMaintenanceRecordDto,
  RecordEquipmentQualificationEventDto,
} from './dto/equipment-qualification.dto'
import { EquipmentQualificationService } from './equipment-qualification.service'

@ApiTags('quality-equipment-qualification')
@Controller('quality/equipment/:equipmentId')
export class EquipmentQualificationController {
  constructor(private readonly service: EquipmentQualificationService) {}

  /** Pass B (item C3) — uploads a validation report; the returned `documentId` is what a passing DQ/IQ/OQ/PQ event cites. */
  @RequirePermissions('quality.manage_equipment')
  @Post('validation-reports')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  attachValidationReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('equipmentId') equipmentId: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.service.attachValidationReport(
      user,
      equipmentId,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { ip: req.ip },
    )
  }

  @RequirePermissions('quality.manage_equipment')
  @Post('qualification-events')
  recordEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('equipmentId') equipmentId: string,
    @Body() dto: RecordEquipmentQualificationEventDto,
    @Req() req: Request,
  ) {
    return this.service.recordEvent(user, equipmentId, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.view_all')
  @Get('qualification-events')
  listEvents(@CurrentUser() user: AuthenticatedUser, @Param('equipmentId') equipmentId: string) {
    return this.service.listEvents(user, equipmentId)
  }

  @RequirePermissions('quality.manage_equipment')
  @Post('maintenance-records')
  recordMaintenance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('equipmentId') equipmentId: string,
    @Body() dto: CreateMaintenanceRecordDto,
    @Req() req: Request,
  ) {
    return this.service.recordMaintenance(user, equipmentId, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.view_all')
  @Get('maintenance-records')
  listMaintenance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('equipmentId') equipmentId: string,
  ) {
    return this.service.listMaintenance(user, equipmentId)
  }
}
