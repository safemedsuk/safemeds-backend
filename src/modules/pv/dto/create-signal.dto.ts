import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateSignalDto {
  @MinLength(1)
  @MaxLength(200)
  @IsString()
  title!: string

  @MinLength(1)
  @MaxLength(5000)
  @IsString()
  description!: string

  @MinLength(1)
  @MaxLength(200)
  @IsString()
  productIdentifier!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  batchNumber?: string

  /** testing-todo Stage 17.2 — set when `productIdentifier` above was picked via the search-and-pick widget against the company's own product catalog, matching `SuspectProductInputDto.productId`'s own precedent (Stage 2). Optional — a signal can still name a product freely without one existing in the catalog. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productId?: string

  /** Case IDs the human raising this signal is pointing at as the evidence — optional, a signal can also be raised on suspicion alone and have cases linked later. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsString({ each: true })
  caseIds?: string[]
}
