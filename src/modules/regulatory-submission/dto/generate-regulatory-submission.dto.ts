import { IsIn, IsOptional } from 'class-validator'

/**
 * Real-usage request, 22 Sep 2026 (item 25) — which ICH E2B format to
 * generate in. Defaults to R2 (what Kenya PPB/VigiFlow, and most
 * African NRAs, actually require) — R3 is offered for a future client
 * outside Africa whose receiving gateway expects the newer HL7 v3
 * message, never silently inferred.
 */
export class GenerateRegulatorySubmissionDto {
  @IsOptional()
  @IsIn(['R2', 'R3'])
  format?: 'R2' | 'R3'
}
