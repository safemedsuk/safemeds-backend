import { IsArray, IsDateString, IsOptional, IsString, IsUUID } from 'class-validator'

export class UpdateBatchDto {
  @IsOptional()
  @IsString()
  batchNumber?: string

  @IsOptional()
  @IsDateString()
  manufacturedOn?: string

  @IsOptional()
  @IsDateString()
  expiresOn?: string

  @IsOptional()
  @IsString()
  batchSize?: string

  @IsOptional()
  @IsString()
  unit?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  parentBatchIds?: string[]

  @IsOptional()
  @IsUUID()
  manufacturingSiteId?: string
}
