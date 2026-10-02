import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export const RECALL_MODES = ['real', 'mock'] as const
export const RECALL_TYPES = ['voluntary', 'directed'] as const
export const RECALL_LEVELS = ['wholesale', 'retail_facility', 'patient'] as const
export const RECALL_TRIGGER_SOURCE_TYPES = [
  'complaint',
  'deviation',
  'capa',
  'adverse_event',
  'regulator',
  'mock',
] as const

export class CreateRecallDto {
  @IsUUID()
  productId!: string

  /** QualCloud (Phase 13) Stage 10.2 — `real` (default) or `mock` (a drill — 10.7). */
  @ApiPropertyOptional({ enum: RECALL_MODES })
  @IsOptional()
  @IsIn(RECALL_MODES)
  mode?: (typeof RECALL_MODES)[number]

  @ApiPropertyOptional({ enum: RECALL_TYPES })
  @IsOptional()
  @IsIn(RECALL_TYPES)
  type?: (typeof RECALL_TYPES)[number]

  @ApiPropertyOptional({ enum: RECALL_LEVELS })
  @IsOptional()
  @IsIn(RECALL_LEVELS)
  level?: (typeof RECALL_LEVELS)[number]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reasonCategory?: string

  /** Polymorphic trigger link — mirrors `Capa.sourceRecordType`/`sourceRecordId`'s own precedent. */
  @ApiPropertyOptional({ enum: RECALL_TRIGGER_SOURCE_TYPES })
  @IsOptional()
  @IsIn(RECALL_TRIGGER_SOURCE_TYPES)
  triggerSourceType?: (typeof RECALL_TRIGGER_SOURCE_TYPES)[number]

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  triggerSourceId?: string

  @MinLength(1)
  @MaxLength(5000)
  @IsString()
  reason!: string

  /**
   * Plain string, deliberately free-text/nullable — a real regulatory
   * classification (Class I/II/III-equivalent) once Kenya's own scheme
   * is sourced. ⚠️ unsourced as of this pass — see `Recall.recallClass`'s
   * own schema doc comment.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  recallClass?: string

  /** Evidence cases the person initiating the recall is already pointing at — optional, cases can also be linked later via `linkCases()`. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsString({ each: true })
  caseIds?: string[]

  /** RegCloud (Phase 12) Stage 14 — QualCloud's own future root-cause CAPA, if one already exists. Left ready and otherwise unenforced — see `Recall.rootCauseCapaId`'s own schema doc comment. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  rootCauseCapaId?: string
}
