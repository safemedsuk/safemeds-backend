import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'

const PERIODIC_REPORT_TYPES = ['psur', 'pbrer', 'dsur', 'pader', 'cioms_ii'] as const

export class GeneratePeriodicReportDto {
  @IsIn(PERIODIC_REPORT_TYPES)
  reportTypeKey!: (typeof PERIODIC_REPORT_TYPES)[number]

  /** Required for psur/pbrer/pader/cioms_ii — the report's subject product. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('7')
  productId?: string

  /** Required for dsur — the report's subject clinical trial. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('7')
  clinicalTrialId?: string

  /**
   * Required for dsur/pader/cioms_ii (no confirmed EURD-style cadence
   * source exists for these — see `PeriodicReportService`'s own doc
   * comment). Optional for psur/pbrer, where omitting both auto-computes
   * the next period from the product's own EURD cadence; supplying them
   * is a manual override of that computation.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  periodStart?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  periodEnd?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  conclusionNote?: string

  /**
   * Real-document-fidelity request, 12 Sep 2026 — bringing the generated
   * PDF up to the real ICH E2C(R2)/E2F section structure surfaced three
   * genuinely variable narrative sections with no other data source
   * (`PeriodicReportPdfService` falls back to the real, standard
   * boilerplate phrasing a PSUR/DSUR uses when nothing changed, never a
   * fabricated claim, when these are omitted).
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  actionsTakenForSafety?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  changesToReferenceSafetyInfo?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  estimatedExposure?: string
}
