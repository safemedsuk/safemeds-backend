import { IsDateString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export class UpdateSopDto {
  @IsOptional()
  @MinLength(1)
  @MaxLength(200)
  @IsString()
  title?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  documentType?: string

  @IsOptional()
  @IsUUID()
  productId?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  processArea?: string

  @IsOptional()
  @IsDateString()
  nextPeriodicReviewDueAt?: string
}
