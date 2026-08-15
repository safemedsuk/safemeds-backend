import { DayType } from '@prisma/client'
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator'

export class CreateReportingRuleDto {
  @IsUUID()
  authorityId!: string

  @IsUUID()
  reportTypeId!: string

  @IsString()
  seriousnessClass!: string

  @IsInt()
  @Min(1)
  windowDays!: number

  @IsOptional()
  @IsEnum(DayType)
  dayType?: DayType

  @IsOptional()
  @IsString()
  clockStart?: string

  @IsOptional()
  @IsBoolean()
  unverified?: boolean

  /** VigiCloud Stage 0.11 — the recurring periodic-report cadence (e.g. PSUR/PBRER every 180 days), distinct from `windowDays`'s incident-triggered deadline. Omit for a rule that has no periodic-reporting obligation. */
  @IsOptional()
  @IsInt()
  @Min(1)
  reportingPeriodDays?: number

  /** VigiCloud Stage 13 — "regulator" (default) or "ethics_committee_and_trial_portal". Plain string, not an enum — see the schema's own doc comment. */
  @IsOptional()
  @IsString()
  submissionDestination?: string

  /** Admin Configuration Console — a plain-text citation for where this number came from (e.g. "GUD/022 §6.1"), purely descriptive. */
  @IsOptional()
  @IsString()
  sourceReference?: string

  @IsDateString()
  effectiveFrom!: string
}
