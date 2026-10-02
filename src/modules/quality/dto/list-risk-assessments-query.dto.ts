import { IsIn, IsOptional, IsString } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListRiskAssessmentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  sourceRecordType?: string

  @IsOptional()
  @IsString()
  sourceRecordId?: string

  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  riskLevel?: string
}
