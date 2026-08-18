import { IsOptional, IsString } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListProductsQueryDto extends PaginationQueryDto {
  /** Trigram search over brandName/genericName/innName/atcCode — Stage 2's "select by brand, INN, or ATC code" requirement. */
  @IsOptional()
  @IsString()
  q?: string
}
