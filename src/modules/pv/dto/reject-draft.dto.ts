import { ApiProperty } from '@nestjs/swagger'
import { IsString, MinLength } from 'class-validator'

/** Real-usage request, 22 Sep 2026 (item 13) — a reason is always required, matching `CaseFollowUp.closedReason`'s own "never a silent close" precedent. */
export class RejectDraftDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  reason: string
}
