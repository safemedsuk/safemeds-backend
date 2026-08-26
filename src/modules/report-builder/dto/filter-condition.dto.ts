import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsString } from 'class-validator'

const OPERATORS = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains'] as const
export type ReportBuilderFilterOperator = (typeof OPERATORS)[number]

/** One `field <operator> value` condition — `field`/`operator` are always re-validated against the chosen data source's real field catalog server-side, never trusted as-is. */
export class FilterConditionDto {
  @ApiProperty()
  @IsString()
  field!: string

  @ApiProperty({ enum: OPERATORS })
  @IsIn(OPERATORS)
  operator!: ReportBuilderFilterOperator

  @ApiProperty()
  @IsString()
  value!: string
}
