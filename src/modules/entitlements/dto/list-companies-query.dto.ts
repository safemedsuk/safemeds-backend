import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListCompaniesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive substring match on company name' })
  @IsOptional()
  @IsString()
  q?: string
}
