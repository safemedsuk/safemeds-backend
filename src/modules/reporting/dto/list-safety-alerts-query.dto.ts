import { ApiPropertyOptional } from '@nestjs/swagger'
import { SafetyAlertStatus } from '@prisma/client'
import { IsEnum, IsOptional } from 'class-validator'

export class ListSafetyAlertsQueryDto {
  @ApiPropertyOptional({ enum: SafetyAlertStatus })
  @IsOptional()
  @IsEnum(SafetyAlertStatus)
  status?: SafetyAlertStatus
}
