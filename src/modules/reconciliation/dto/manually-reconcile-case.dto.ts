import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, IsUUID } from 'class-validator'

export class ManuallyReconcileCaseDto {
  @ApiPropertyOptional({
    description:
      'The distributor this case actually came from — omit/null to confirm it is genuinely not distributor-sourced',
  })
  @IsOptional()
  @IsUUID()
  distributorId?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string
}
