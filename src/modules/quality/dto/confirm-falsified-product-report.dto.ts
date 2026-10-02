import { IsBoolean, IsOptional } from 'class-validator'

export class ConfirmFalsifiedProductReportDto {
  /** Opens a linked Deviation (`sourceType: 'monitoring_alert'`) always, on confirm. */
  @IsOptional()
  @IsBoolean()
  routeToPvCase?: boolean

  @IsOptional()
  @IsBoolean()
  authorityNotified?: boolean
}
