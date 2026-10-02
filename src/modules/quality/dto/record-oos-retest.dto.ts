import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator'

/**
 * QualCloud (Phase 13) Stage 6 — `rationale` is always required, whether
 * a retest is being authorized or declined: "structurally requires a
 * written rationale before a retest can even be logged" — the exact
 * control against "testing into compliance" data-integrity violations
 * the whole OOS literature warns about.
 */
export class RecordOosRetestDto {
  @IsBoolean()
  authorized!: boolean

  @MinLength(1)
  @MaxLength(2000)
  @IsString()
  rationale!: string
}
