import { IsDateString, IsIn, IsString, MinLength } from 'class-validator'

export const REG_QUERY_CORRESPONDENCE_DIRECTIONS = [
  'from_regulator',
  'to_regulator',
  'internal_note',
] as const
export const REG_QUERY_CORRESPONDENCE_CHANNELS = [
  'letter',
  'email',
  'phone',
  'portal',
  'note',
] as const

/** CEO feedback, 30 Sep 2026 — "every letter, email and document exchanged on a query kept in one thread, with dates, including follow-up questions and multiple response rounds." `file` stays optional at the HTTP layer — an `internal_note`/`phone` entry legitimately has no document. */
export class LogRegQueryCorrespondenceDto {
  @IsIn(REG_QUERY_CORRESPONDENCE_DIRECTIONS)
  direction!: 'from_regulator' | 'to_regulator' | 'internal_note'

  @IsIn(REG_QUERY_CORRESPONDENCE_CHANNELS)
  channel!: 'letter' | 'email' | 'phone' | 'portal' | 'note'

  @IsDateString()
  occurredOn!: string

  @IsString()
  @MinLength(1)
  summary!: string
}
