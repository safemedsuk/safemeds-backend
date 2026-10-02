import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator'

import {
  AdverseEventInputDto,
  CaseConsentInputDto,
  PatientInputDto,
  PregnancyInputDto,
  ReporterInputDto,
  SuspectProductInputDto,
} from '../../pv/dto/create-pv-case.dto'

/**
 * VigiCloud Stage 3.2 — the cut-down public form: "reporter + minimal
 * patient/product/event fields; no internal-only fields" (per the todo
 * doc's own wording). Deliberately reuses the exact same nested DTOs
 * `CreatePvCaseDto` uses (`ReporterInputDto`, `PatientInputDto`, ...)
 * rather than a parallel set — the validation a public submission needs
 * for "what happened" is identical to the authenticated wizard's; what's
 * missing here is only the *internal* classification fields
 * (`reportTypeId`, both country FKs, `awarenessDate`/`receivedDate`),
 * which `PublicReportingService.submit()` defaults server-side instead
 * of asking an anonymous member of the public to understand them.
 */
export class SubmitPublicReportDto {
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

  @ApiPropertyOptional({ type: CaseConsentInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CaseConsentInputDto)
  consent?: CaseConsentInputDto

  /** Real-usage bug, 22 Sep 2026 — see `CreatePvCaseDto.contactConsent`'s own doc comment for the full account; the public form needs this exactly as much as the internal wizard does. */
  @ApiPropertyOptional({ type: CaseConsentInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CaseConsentInputDto)
  contactConsent?: CaseConsentInputDto

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  suspectedFalsifiedOrSubstandard?: boolean

  @ApiPropertyOptional({ type: PregnancyInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PregnancyInputDto)
  pregnancy?: PregnancyInputDto

  /**
   * Real-usage request, 22 Sep 2026 (item 12) — "add country of
   * residence on the About You card... when cases are reported from
   * here, both country codes on the reference number should match the
   * country of residence." Optional at the DTO level only so an older
   * client can't be broken by a required-field validation error — the
   * frontend form always collects it going forward, and
   * `PublicReportingService.submit()` falls back to the company's own
   * home country when it's genuinely missing.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  countryOfResidenceId?: string
}
