import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator'

export class RecordSignalValidationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  previousAwareness?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  previousAwarenessNote?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  clinicalRelevanceNote?: string
}
