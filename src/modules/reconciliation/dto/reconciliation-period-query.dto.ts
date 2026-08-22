import { ApiProperty } from '@nestjs/swagger'
import { IsDateString } from 'class-validator'

export class ReconciliationPeriodQueryDto {
  @ApiProperty()
  @IsDateString()
  periodStart: string

  @ApiProperty()
  @IsDateString()
  periodEnd: string
}
