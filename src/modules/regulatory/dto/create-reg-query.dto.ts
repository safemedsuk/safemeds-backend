import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator'

export class CreateRegQueryDto {
  @IsString()
  @MinLength(1)
  queryText!: string

  /** Defaults to today when omitted — the regulator's query is being logged, not necessarily on the exact day it arrived. */
  @IsOptional()
  @IsDateString()
  receivedDate?: string
}
