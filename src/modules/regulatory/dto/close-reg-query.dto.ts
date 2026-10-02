import { IsOptional, IsString } from 'class-validator'

/** CEO feedback, 30 Sep 2026 — a formal closure step distinct from `respond()`'s own "responded" status. */
export class CloseRegQueryDto {
  @IsOptional()
  @IsString()
  note?: string
}
