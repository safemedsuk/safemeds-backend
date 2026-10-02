import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsArray, IsInt, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator'

export class PartPackInputDto {
  @IsInt()
  @Min(0)
  unitsRemaining!: number

  @IsInt()
  @Min(1)
  unitsPerPack!: number
}

export class CreateRecallQuarantineRecordDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  stakeholderId?: string

  @IsUUID()
  batchId!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  fullPacks?: number

  @ApiPropertyOptional({ type: [PartPackInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PartPackInputDto)
  partPacks?: PartPackInputDto[]

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceDocumentIds?: string[]
}
