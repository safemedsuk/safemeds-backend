import { IsObject } from 'class-validator'

/**
 * Real-document-fidelity request, 12 Sep 2026 — the "create from
 * scratch" half of RMP generation, mirroring `UpdatePsmfContentDto`'s
 * own reasoning exactly: deliberately loose (`IsObject()` only) since
 * `RmpContent` (`rmp-pdf.service.ts`) is a genuinely deep, 6-part
 * shape with every field optional by design, and this is only ever
 * written by SafeMeds' own controlled frontend form, never raw
 * external input.
 */
export class UpdateRmpContentDto {
  @IsObject()
  content!: Record<string, unknown>
}
