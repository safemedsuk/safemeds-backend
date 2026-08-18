import { IsDateString, IsOptional, IsString } from 'class-validator'

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
}
