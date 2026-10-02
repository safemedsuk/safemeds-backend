import { Type } from 'class-transformer'
import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator'

export class AssemblePqrDto {
  @IsUUID()
  productId!: string

  @IsDateString()
  periodStart!: string

  @IsDateString()
  periodEnd!: string
}

export class PqrRecommendedActionDto {
  @IsString()
  @MaxLength(1000)
  description!: string

  @IsOptional()
  @IsUUID()
  ownerUserId?: string

  /** When true, `review()` opens a real `Capa` for this action via `createFrom('pqr_action', ...)`. */
  @IsOptional()
  openCapa?: boolean

  @IsOptional()
  @IsString()
  @MaxLength(200)
  rootCauseCategory?: string
}

export class ReviewPqrDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  conclusionsNarrative?: string

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  trendsNarrative?: string

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PqrRecommendedActionDto)
  recommendedActions?: PqrRecommendedActionDto[]

  @IsString()
  @IsNotEmpty()
  intentStatement!: string

  @IsString()
  @IsNotEmpty()
  signatureToken!: string
}
