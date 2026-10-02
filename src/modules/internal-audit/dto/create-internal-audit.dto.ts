import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export const AUDIT_SCOPES = ['internal', 'supplier', 'regulatory'] as const

export class CreateInternalAuditDto {
  @MinLength(1)
  @MaxLength(200)
  @IsString()
  title!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  scope?: string

  @IsDateString()
  scheduledDate!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  leadAuditorUserId?: string

  /** `internal | supplier | regulatory` — defaults to `internal` when omitted. */
  @ApiPropertyOptional({ enum: AUDIT_SCOPES })
  @IsOptional()
  @IsIn(AUDIT_SCOPES)
  auditScope?: (typeof AUDIT_SCOPES)[number]

  /** Required only when `auditScope` is `supplier`. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('7')
  supplierId?: string
}
