import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

/** Real-usage request, 22 Sep 2026 (item 6) — "proof distributors are actually trained annually," mirroring `CreateTrainingRecordDto`'s own shape exactly, scoped to a distributor instead of a staff member. */
export class CreateDistributorTrainingRecordDto {
  @IsUUID()
  distributorId!: string

  @MinLength(1)
  @MaxLength(100)
  @IsString()
  trainingType!: string

  @MinLength(1)
  @MaxLength(200)
  @IsString()
  title!: string

  @IsDateString()
  completionDate!: string

  @ApiPropertyOptional({ description: 'Omit if this training has no expiry — most annual PV training does, so set it to roughly a year out.' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string
}
