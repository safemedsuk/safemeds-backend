import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator'

/**
 * Real-usage request, 22 Sep 2026 (item 20) — renewing either a trial's
 * regulatory-authority or ethics-committee approval. Always a distinct,
 * audited action (`ClinicalTrialService.renewApproval()`), never a plain
 * field overwrite via the generic `PATCH .../:id` — a renewal is a real
 * compliance event with its own document/date, not incidental metadata.
 */
export class RenewClinicalTrialApprovalDto {
  @ApiProperty({ enum: ['regulatory', 'ethics'] })
  @IsIn(['regulatory', 'ethics'])
  approvalType: 'regulatory' | 'ethics'

  @ApiProperty({ description: 'The new approval PDF — upload first via the generic documents endpoint.' })
  @IsUUID()
  documentId: string

  @ApiProperty()
  @IsDateString()
  approvalDate: string

  @ApiPropertyOptional({ description: 'Omit if the renewed approval has no expiry.' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string
}
