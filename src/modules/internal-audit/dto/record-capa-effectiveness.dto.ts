import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

const RESULTS = ['effective', 'not_effective'] as const

export class RecordCapaEffectivenessDto {
  @IsIn(RESULTS)
  result!: (typeof RESULTS)[number]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string
}
