import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator'

import { FilterConditionDto } from './filter-condition.dto'

const DATA_SOURCES = ['pv_case', 'reg_dossier'] as const

/** The query shape shared by both a live preview and a saved definition — kept as its own base class so `SaveReportDefinitionDto` doesn't repeat these four fields. */
export class BuildReportQueryDto {
  @IsIn(DATA_SOURCES)
  dataSource!: (typeof DATA_SOURCES)[number]

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  fields!: string[]

  @ApiPropertyOptional({ type: [FilterConditionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FilterConditionDto)
  filters?: FilterConditionDto[]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  groupByField?: string
}
