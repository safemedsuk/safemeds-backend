import { Transform } from 'class-transformer'
import { IsBoolean, IsOptional } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListCountriesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  configured?: boolean
}
