import { ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator'

export const RECALL_RULE_DAY_BASIS = ['calendar', 'working'] as const

export class CreateRecallRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  code!: string

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  requirementText!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  appliesWhenClass?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  appliesWhenLevel?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  appliesWhenType?: string

  /** Plain, company-extensible string — e.g. `regulator_approval_of_recall | recall_decision | trigger_received`. */
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  anchorEvent!: string

  @IsInt()
  offset!: number

  @IsOptional()
  @IsIn(['days'])
  unit?: string

  @ApiPropertyOptional({ enum: RECALL_RULE_DAY_BASIS })
  @IsOptional()
  @IsIn(RECALL_RULE_DAY_BASIS)
  dayBasis?: (typeof RECALL_RULE_DAY_BASIS)[number]

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  ownerRoleKey!: string

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceTypes?: string[]

  @IsOptional()
  @IsBoolean()
  approvalRequired?: boolean

  @IsOptional()
  @IsBoolean()
  blocksClosure?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  submissionTemplateId?: string

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  sourceDoc!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceInstrument?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceSection?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceUrl?: string

  /** Defaults `true` — a rule only ever drives a real deadline once explicitly confirmed and the rule-set is `live`. */
  @IsOptional()
  @IsBoolean()
  unverified?: boolean
}
