import { IsEmail, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator'

const ENGAGEMENT_TYPES = ['full_service', 'dossier_review_only', 'client_handles_queries'] as const

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string

  /** RegCloud (Phase 12) Stage 15 — the company's default engagement model; see `Company.engagementType`'s own schema doc comment. */
  @IsOptional()
  @IsIn(ENGAGEMENT_TYPES)
  engagementType?: string

  /**
   * testing-correction-explanation.md decision #4 — this was, until now,
   * a genuinely write-never field: every PDF/E2B/letter service already
   * reads it, but no endpoint anywhere ever let a tenant set it. Also the
   * real recipient for retention (§3.4) and renewal (§3.2) reminder
   * emails. Kept optional at the DTO level — a company created before
   * this fix stays valid — but every reminder job logs (never throws)
   * when it's still empty, and Company Profile now surfaces a real
   * "add your company email" prompt until it's filled in.
   */
  @IsOptional()
  @IsEmail()
  regulatoryContactEmail?: string

  /** QualCloud (Phase 13) Stage 10.7 — the mock-recall cadence, in months. `null`/omitted defaults to 12 (annual). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  mockRecallCadenceMonths?: number
}
