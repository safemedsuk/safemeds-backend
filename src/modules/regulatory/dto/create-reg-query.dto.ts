import { IsDateString, IsOptional, IsString, IsUUID, MinLength } from 'class-validator'

/**
 * testing-correction-explanation.md §2.1 — "these logs/queries always
 * come from the PPB... it is important... make it mandatory and also
 * make the submission of a document mandatory as well together with the
 * received on date." All three are now genuinely required — `queryText`
 * is a searchable transcription, never a substitute for the real scanned
 * letter (`queryLetterDocumentId`, uploaded alongside this same request —
 * see `RegQueryController.receive()`'s multipart handling).
 */
export class CreateRegQueryDto {
  @IsString()
  @MinLength(1)
  queryText!: string

  /** The real date the query was received from the regulator — no longer defaults to today, since that's the whole point of a compliance record. */
  @IsDateString()
  receivedDate!: string

  /** CEO feedback, 30 Sep 2026 — the regulator's own stated deadline, entered manually at log time (can also be set/corrected later via `PATCH .../due-date`). */
  @IsOptional()
  @IsDateString()
  responseDueDate?: string

  /** CEO feedback, 30 Sep 2026 — ownership can be set at log time, or assigned/reassigned afterward via `PATCH .../owner`. */
  @IsOptional()
  @IsUUID('7')
  ownerUserId?: string
}
