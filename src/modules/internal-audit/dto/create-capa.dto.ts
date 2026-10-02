import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateCapaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  findingId?: string

  /**
   * QualCloud (Phase 13) Stage 0.3 — the generalized polymorphic pair.
   * Optional here because `findingId` alone still works unchanged (it's
   * auto-mapped to `sourceRecordType: 'audit_finding'` by the service) —
   * any future quality-event module (deviation, OOS/OOT, complaint,
   * change control, recall, PQR, supplier-audit finding) passes these
   * two instead.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceRecordType?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceRecordId?: string

  @MinLength(1)
  @MaxLength(200)
  @IsString()
  title!: string

  @MinLength(1)
  @MaxLength(2000)
  @IsString()
  correctiveAction!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  preventiveAction?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerUserId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string

  /** QualCloud (Phase 13) Stage 3 — drives the reopen-on-recurrence check; see `CapaService`'s own doc comment. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  rootCauseCategory?: string
}
