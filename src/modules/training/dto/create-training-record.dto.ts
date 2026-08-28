import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateTrainingRecordDto {
  @IsString()
  userId!: string

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiryDate?: string
}
