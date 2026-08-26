import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator'

export class SafetyLetterRecipientInputDto {
  @MinLength(1)
  @MaxLength(200)
  @IsString()
  name!: string

  @IsEmail()
  email!: string
}

const LETTER_TYPES = ['dhcp', 'dil'] as const

/**
 * Field-expert document review (11 Sep 2026) — rebuilt against the real
 * `Draft Kenya DHCPL.docx` sample, matching the same "generated documents
 * must have the exact same content type and form" standard applied to the
 * PSMF/QPPV-nomination rebuilds. `ppbApprovalReference` is the real
 * "PPB-pre-approval-reference gate" CLAUDE.md's own notes had already
 * flagged as a genuine gap — required here, so no letter can even be
 * generated without one, the bounded version of that gate.
 */
export class GenerateSafetyLetterDto {
  @IsUUID('7')
  safetyAlertId!: string

  @IsIn(LETTER_TYPES)
  letterType!: (typeof LETTER_TYPES)[number]

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('7')
  productId?: string

  /** The real sample's own header field — a letter cannot be generated without a genuine PPB pre-approval reference. */
  @MinLength(1)
  @MaxLength(100)
  @IsString()
  ppbApprovalReference!: string

  /** "Background Information & Clinical Relevance" section. */
  @MinLength(1)
  @MaxLength(5000)
  @IsString()
  backgroundInformation!: string

  /** "Actionable Guidance for Healthcare Providers" section. */
  @MinLength(1)
  @MaxLength(5000)
  @IsString()
  actionableGuidance!: string

  /** Sign-off signatory name (e.g. the QPPV's own name). */
  @MinLength(1)
  @MaxLength(200)
  @IsString()
  signatoryName!: string

  /** Sign-off title — defaults to "Medical Director / QPPV" (the sample's own title) if omitted. */
  @ApiPropertyOptional()
  @IsOptional()
  @MaxLength(200)
  @IsString()
  signatoryTitle?: string

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SafetyLetterRecipientInputDto)
  recipients!: SafetyLetterRecipientInputDto[]
}
