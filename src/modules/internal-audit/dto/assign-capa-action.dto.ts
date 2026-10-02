import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * QualCloud (Phase 13) Stage 3 — three distinct, commonly-conflated GMP
 * concepts, each its own field: `correction` (the immediate fix),
 * `correctiveAction` (fixes this occurrence's root cause),
 * `preventiveAction` (prevents recurrence system-wide). All optional
 * here (a partial update) — `correctiveAction` itself is required at
 * creation time (`CreateCapaDto`), this endpoint only ever refines it.
 */
export class AssignCapaActionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  correction?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  correctiveAction?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  preventiveAction?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  rootCauseCategory?: string
}
