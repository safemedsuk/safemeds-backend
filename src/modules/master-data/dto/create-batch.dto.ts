import { IsArray, IsDateString, IsOptional, IsString, IsUUID } from 'class-validator'

export class CreateBatchDto {
  @IsUUID()
  productId!: string

  @IsString()
  batchNumber!: string

  @IsDateString()
  manufacturedOn!: string

  @IsDateString()
  expiresOn!: string

  @IsOptional()
  @IsString()
  batchSize?: string

  @IsOptional()
  @IsString()
  unit?: string

  /** QualCloud (Phase 13) Stage 7 — the upstream batch/lot references this batch was made from, real genealogy. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  parentBatchIds?: string[]

  @IsOptional()
  @IsUUID()
  manufacturingSiteId?: string
}
