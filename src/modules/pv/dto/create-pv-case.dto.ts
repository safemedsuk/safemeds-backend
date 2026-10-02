import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  CaseChannel,
  ConsentMethod,
  DrugCharacterization,
  PatientSex,
  PregnancyOutcome,
  ReactionOutcome,
  ReporterType,
} from '@prisma/client'
import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export class ReporterInputDto {
  @ApiProperty({ enum: ReporterType })
  @IsEnum(ReporterType)
  reporterType: ReporterType

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fullName?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string

  @ApiPropertyOptional({ description: 'e.g. "Pharmacist", "Nurse", "Patient/Consumer"' })
  @IsOptional()
  @IsString()
  qualification?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  countryId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  organization?: string
}

export class PatientInputDto {
  @ApiPropertyOptional({
    description: 'e.g. "J.M." — never a full name, per Kenyan PV form convention',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  initials?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string

  @ApiPropertyOptional({ description: 'Used when exact date of birth is unknown' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(130)
  ageYears?: number

  @ApiPropertyOptional({ enum: PatientSex, default: 'unknown' })
  @IsOptional()
  @IsEnum(PatientSex)
  sex?: PatientSex

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  weightKg?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  heightCm?: number

  @ApiPropertyOptional({
    description: 'Free text — encrypted at rest before ever reaching the database',
  })
  @IsOptional()
  @IsString()
  medicalHistory?: string
}

export class SuspectProductInputDto {
  @ApiProperty({ enum: DrugCharacterization })
  @IsEnum(DrugCharacterization)
  drugCharacterization: DrugCharacterization

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  medicinalProduct: string

  /**
   * VigiCloud Stage 2 — optional link to a `Product` in the tenant's own
   * catalog (the case-intake product picker sets this when the reporter
   * picked a real catalog entry). Every other field on this row remains
   * the actual source of truth for what was reported, regardless of
   * whether this is set — see `SuspectProduct.productId`'s own schema
   * doc comment for why this is never required.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  activeSubstanceName?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  atcCode?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dosageForm?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  route?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  doseText?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  batchNumber?: string

  /** Real-usage request, 22 Sep 2026 — see `SuspectProduct.genericName`'s own schema doc comment. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  genericName?: string

  /** Real-usage request, 22 Sep 2026 — the physical batch's own manufacturing date, distinct from `startDate` (the patient's own exposure window) below. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  manufacturingDate?: string

  /** Real-usage request, 22 Sep 2026 — the physical batch's own expiry date. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiryDate?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actionTaken?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  obtainedCountryId?: string

  /**
   * VigiCloud Stage 3.1 — special-situation flags matching ICH E2B(R2)'s
   * `drugadditional` field group, modelled per suspect product (see
   * `SuspectProduct`'s own schema doc comment).
   */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isOverdose?: boolean

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isOffLabelUse?: boolean

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isMisuse?: boolean

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isMedicationError?: boolean
}

export class AdverseEventInputDto {
  @ApiPropertyOptional({
    description: 'Pre-coded MedDRA term, if already known — full coding workflow is Stage 7',
  })
  @IsOptional()
  @IsUUID()
  meddraTermId?: string

  @ApiProperty({
    description: "The reporter's own words for the reaction, before any MedDRA coding",
  })
  @IsString()
  @IsNotEmpty()
  reportedTerm: string

  @ApiProperty({
    description: 'Free-text narrative — encrypted at rest before ever reaching the database',
  })
  @IsString()
  @IsNotEmpty()
  narrative: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  onsetDate?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  resolutionDate?: string

  @ApiPropertyOptional({ enum: ReactionOutcome, default: 'unknown' })
  @IsOptional()
  @IsEnum(ReactionOutcome)
  outcome?: ReactionOutcome

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  seriousnessDeath?: boolean

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  seriousnessLifeThreatening?: boolean

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  seriousnessHospitalization?: boolean

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  seriousnessDisabling?: boolean

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  seriousnessCongenitalAnomaly?: boolean

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  seriousnessOther?: boolean

  /**
   * VigiCloud Stage 3.1 — per CLAUDE.md's confirmed domain knowledge,
   * "Therapeutic ineffectiveness IS formally reportable" on the Kenyan
   * PPB form. Describes the nature of the reported outcome, not a
   * product-usage circumstance — see `AdverseEvent.isLackOfEfficacy`'s
   * own schema doc comment for why this lives here, not on the product.
   */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isLackOfEfficacy?: boolean
}

export class CaseConsentInputDto {
  @ApiProperty({
    description: 'True if the reporter/patient consented to this report being processed',
  })
  @IsBoolean()
  granted: boolean

  @ApiProperty({ enum: ConsentMethod })
  @IsEnum(ConsentMethod)
  method: ConsentMethod
}

/**
 * VigiCloud Stage 3.1 — one of the special-situation field sets "built
 * directly into intake, not bolted on afterward." Only meaningful when
 * the intake wizard's "Pregnancy exposure" toggle is on — see
 * `PregnancyContext`'s own schema doc comment.
 */
export class PregnancyInputDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(45)
  gestationWeeksAtExposure?: number

  @ApiPropertyOptional({ enum: PregnancyOutcome, default: 'ongoing' })
  @IsOptional()
  @IsEnum(PregnancyOutcome)
  outcome?: PregnancyOutcome

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  congenitalAnomalyDetail?: string
}

export class CreatePvCaseDto {
  @ApiProperty({ description: 'FK to ReportType — GET /report-types for the catalog' })
  @IsUUID()
  reportTypeId: string

  @ApiProperty()
  @IsUUID()
  countryOfOccurrenceId: string

  @ApiProperty()
  @IsUUID()
  countryOfReportId: string

  @ApiPropertyOptional({ enum: CaseChannel, default: 'form' })
  @IsOptional()
  @IsEnum(CaseChannel)
  channel?: CaseChannel

  /**
   * VigiCloud Stage 14 — required (enforced in `PvCaseService.create()`,
   * not here, since the rule is conditional on `channel`) whenever
   * `channel` is `clinical_study`: a clinical-trial SAE is *solicited*,
   * not spontaneous, and always traces back to a specific trial.
   */
  @ApiPropertyOptional({ description: 'Required when channel is clinical_study' })
  @IsOptional()
  @IsUUID()
  clinicalTrialId?: string

  @ApiPropertyOptional({
    description:
      'Optional even on a clinical-trial case — a case can describe a subject who was never pre-registered',
  })
  @IsOptional()
  @IsUUID()
  clinicalTrialSubjectId?: string

  @ApiProperty({
    description:
      'When the QPPV/company first became aware of the case — the reporting-clock start date',
  })
  @IsDateString()
  awarenessDate: string

  @ApiProperty({ description: 'When this specific report was received' })
  @IsDateString()
  receivedDate: string

  @ApiPropertyOptional({
    description: 'Free-text — encrypted at rest before ever reaching the database',
  })
  @IsOptional()
  @IsString()
  additionalInformation?: string

  @ApiProperty({ type: ReporterInputDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ReporterInputDto)
  reporter: ReporterInputDto

  @ApiProperty({ type: PatientInputDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PatientInputDto)
  patient: PatientInputDto

  @ApiProperty({
    type: [SuspectProductInputDto],
    description: 'At least one suspect product is required',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SuspectProductInputDto)
  suspectProducts: SuspectProductInputDto[]

  @ApiProperty({
    type: [AdverseEventInputDto],
    description: 'At least one adverse event is required',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdverseEventInputDto)
  adverseEvents: AdverseEventInputDto[]

  @ApiPropertyOptional({
    type: CaseConsentInputDto,
    description: 'Captured as a ConsentRecord (Stage 0.1) against this case, consentType "report"',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CaseConsentInputDto)
  consent?: CaseConsentInputDto

  /**
   * Real-usage bug, 22 Sep 2026 — "we need to take consent for follow
   * up during adverse report reporting." Found while checking this:
   * `CaseFollowUpService.startCycle()` has always required a real
   * `consentType: 'contact'` `ConsentRecord` before it will ever queue
   * an automated email, but **nothing anywhere — not the internal
   * wizard, not the public form, not email/WhatsApp intake — has ever
   * captured one**, only `'report'` (data-processing) consent. Every
   * case, on every channel, has been silently ineligible for automated
   * follow-up since Stage 11 shipped; the manual phone fallback would
   * have shown "contact consent not on file" for all of them too. A
   * genuinely separate field, not a rename of `consent` above — a
   * reporter can consent to their report being processed without
   * agreeing to be personally contacted again.
   */
  @ApiPropertyOptional({
    type: CaseConsentInputDto,
    description: 'Captured as a ConsentRecord against this case, consentType "contact" — required before an automated follow-up email can ever be sent',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CaseConsentInputDto)
  contactConsent?: CaseConsentInputDto

  /**
   * VigiCloud Stage 3.1 — a `Case` flag, not a separate intake path (see
   * `Case.suspectedFalsifiedOrSubstandard`'s own schema doc comment).
   */
  @ApiPropertyOptional({
    default: false,
    description:
      'Flags this case as also raising a falsified/substandard-product concern about the suspect product(s) involved',
  })
  @IsOptional()
  @IsBoolean()
  suspectedFalsifiedOrSubstandard?: boolean

  @ApiPropertyOptional({
    type: PregnancyInputDto,
    description: 'Only present when the reporter indicated pregnancy exposure',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PregnancyInputDto)
  pregnancy?: PregnancyInputDto

  /**
   * VigiCloud Stage 10 — "a reporter citing an existing case's reference
   * number should short-circuit straight to a match, not run the fuzzy
   * search at all." When a reporter explicitly says "I'm following up
   * on PV-2026-00123," that's a stronger signal than any similarity
   * algorithm could produce — `DuplicateDetectionService` looks this up
   * directly rather than relying on the fuzzy country/sex/age/product/
   * reaction filter for this specific pair.
   */
  @ApiPropertyOptional({
    description:
      'An existing case reference number this report says it follows up on, if the reporter cited one',
  })
  @IsOptional()
  @IsString()
  citedCaseReferenceNumber?: string
}
