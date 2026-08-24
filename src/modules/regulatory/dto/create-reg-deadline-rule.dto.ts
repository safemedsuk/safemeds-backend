import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator'

export class CreateRegDeadlineRuleDto {
  @IsUUID()
  countryId!: string

  @IsUUID()
  authorityId!: string

  @IsOptional()
  @IsString()
  productClass?: string

  @IsString()
  obligationType!: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  intervalValue!: number

  @IsIn(['days', 'months', 'years'])
  intervalUnit!: 'days' | 'months' | 'years'

  @IsOptional()
  @IsString()
  clockStart?: string

  @IsOptional()
  @IsBoolean()
  unverified?: boolean

  @IsOptional()
  @IsString()
  sourceReference?: string

  @IsDateString()
  effectiveFrom!: string
}
