import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

export class UpdateRiskAssessmentDto {
  @IsOptional()
  @MinLength(1)
  @MaxLength(200)
  @IsString()
  title?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  severity?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  probability?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  detectability?: number

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  mitigationActions?: string

  @IsOptional()
  @IsUUID()
  capaId?: string
}
