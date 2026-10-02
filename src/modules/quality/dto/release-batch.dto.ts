import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator'

export class RiskAcceptanceItemDto {
  @IsIn(['quality_deviation', 'quality_oos', 'quality_complaint'])
  recordType!: string

  @IsUUID()
  recordId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string
}

export class ReleaseBatchDto {
  @IsIn(['released', 'rejected'])
  decision!: string

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RiskAcceptanceItemDto)
  riskAcceptances!: RiskAcceptanceItemDto[]

  @IsString()
  @MinLength(1)
  intentStatement!: string

  @IsString()
  @MinLength(1)
  signatureToken!: string
}
