import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator'

/** A staff member's real-world outcome for whichever follow-up attempt is currently pending — never `pending` itself, that's the system's own starting state, not something a human "logs." */
export type LoggableFollowUpOutcome =
  'responded_resolved' | 'responded_new_information' | 'no_response'

const LOGGABLE_OUTCOMES: LoggableFollowUpOutcome[] = [
  'responded_resolved',
  'responded_new_information',
  'no_response',
]

/** VigiCloud Stage 11 — the FE's "log a follow-up contact" action, primarily for phone-based follow-up but usable for any channel a staff member personally handled (e.g. a reporter replying to the automated email directly to their inbox). */
export class LogFollowUpAttemptDto {
  @ApiProperty({ enum: LOGGABLE_OUTCOMES })
  @IsIn(LOGGABLE_OUTCOMES)
  outcome: LoggableFollowUpOutcome

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string

  @ApiPropertyOptional({
    description:
      'Real-usage request, 22 Sep 2026 (item 18) — a document the reporter sent as part of this response. Upload it first via the generic documents endpoint, then pass the resulting document id here.',
  })
  @IsOptional()
  @IsUUID()
  documentId?: string
}
