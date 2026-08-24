import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export class CreateRecallDto {
  @IsUUID()
  productId!: string

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
