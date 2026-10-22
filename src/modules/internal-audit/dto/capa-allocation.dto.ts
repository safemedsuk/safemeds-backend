import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator'

/**
 * QualCloud Phase 1 Pass A2 — the one allocation shape every user-facing
 * CAPA opener (the CAPA form itself, a Deviation, an OOS/OOT, a Complaint,
 * an Audit Finding) shares. Owner, separate corrective/preventive due
 * dates, root cause, and (optionally) a designated regulatory approver are
 * required by the rule, not by UI convention — `CapaAllocation` in
 * `capa-allocation.ts` is the single place those rules are enforced.
 *
 * `title` is deliberately absent: the CAPA title is derived from
 * `rootCause`, so an empty-title CAPA cannot exist.
 */
export class CapaAllocationDto {
  @ApiProperty({ description: 'What caused the problem, in free text.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  rootCause!: string

  @ApiProperty({
    description:
      'A key from GET /capas/root-cause-categories, or "other" (then rootCauseOther is required).',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  rootCauseCategory!: string

  @ApiPropertyOptional({ description: 'Typed free text when rootCauseCategory is "other".' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  rootCauseOther?: string

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  correctiveAction!: string

  @ApiPropertyOptional({
    description: 'Required (with preventiveActionDueDate) whenever given.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  preventiveAction?: string

  @ApiProperty({ description: 'The allocated owner. Must hold quality.manage_capa.' })
  @IsNotEmpty()
  @IsUUID()
  ownerUserId!: string

  @ApiProperty({ description: 'ISO date (YYYY-MM-DD).' })
  @IsDateString()
  correctiveActionDueDate!: string

  @ApiPropertyOptional({ description: 'ISO date. Required whenever preventiveAction is given.' })
  @IsOptional()
  @IsDateString()
  preventiveActionDueDate?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresRegulatoryApproval?: boolean

  @ApiPropertyOptional({
    description:
      'Required when requiresRegulatoryApproval is true. Must hold regulatory.manage_registrations.',
  })
  @IsOptional()
  @IsUUID()
  regulatoryApproverUserId?: string
}
