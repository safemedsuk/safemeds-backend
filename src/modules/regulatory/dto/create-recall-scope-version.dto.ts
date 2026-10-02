import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsArray, IsInt, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator'

export class RecallScopeItemInputDto {
  @IsUUID()
  productId!: string

  @IsUUID()
  batchId!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  batchSize?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  quantityDistributed?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  quantityHeldByMah?: number
}

export class CreateRecallScopeVersionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecallScopeItemInputDto)
  items!: RecallScopeItemInputDto[]
}
