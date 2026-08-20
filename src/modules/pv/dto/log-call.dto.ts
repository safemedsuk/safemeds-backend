import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { CallOutcome } from '@prisma/client'
import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator'

import { CreatePvCaseDto } from './create-pv-case.dto'

/**
 * VigiCloud Stage 3.5 (+ Stage 21's voicemail/missed-call fields) — the
 * "Log a call" quick-entry screen's payload. `case` is the exact same
 * graph `POST /pv/cases` accepts — a call that results in a reportable
 * case is created exactly like a web-form case, just with `channel`
 * forced to `hotline_phone` server-side rather than chosen by the
 * caller.
 */
export class LogCallDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  callerNumber: string

  @ApiProperty()
  @IsDateString()
  occurredAt: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number

  @ApiProperty({ enum: CallOutcome })
  @IsEnum(CallOutcome)
  outcome: CallOutcome

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string

  @ApiPropertyOptional({
    type: CreatePvCaseDto,
    description: 'Required when outcome is "case_created", disallowed otherwise',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePvCaseDto)
  case?: CreatePvCaseDto

  @ApiPropertyOptional({
    description:
      'VigiCloud Stage 21 — true when this logs a missed call or voicemail rather than a call actually answered live',
  })
  @IsOptional()
  @IsBoolean()
  isVoicemail?: boolean

  @ApiPropertyOptional({
    description:
      'An already-uploaded Document id holding the voicemail audio, if one exists to attach',
  })
  @IsOptional()
  @IsUUID()
  audioDocumentId?: string

  @ApiPropertyOptional({
    description:
      "A human's own transcription/summary of the voicemail — never an automated transcript (Tier 3, deferred)",
  })
  @IsOptional()
  @IsString()
  transcriptionNote?: string
}
