import { IsObject } from 'class-validator'

/**
 * Real-usage content, 11 Sep 2026 — the "create from scratch" half of
 * PSMF onboarding. Deliberately loose (`IsObject()` only, not a fully
 * validated nested DTO per field) — `PsmfContent` (`psmf-pdf.service.ts`)
 * is a genuinely deep, 7-section shape, every field of it optional by
 * design (an incomplete section renders honestly as "Not yet provided"
 * rather than blocking the draft from being savable at all), and this
 * is only ever written by SafeMeds' own controlled frontend form, never
 * raw external input — matching `FormSchema.jsonSchema`'s own established
 * "flexible structured content, not deeply validated" precedent.
 */
export class UpdatePsmfContentDto {
  @IsObject()
  content!: Record<string, unknown>
}
