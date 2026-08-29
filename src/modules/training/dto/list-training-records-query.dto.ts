import { IsOptional, IsString } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

/** Real-usage report, 19 Aug 2026 — plain substring search across the staff member's name/email and the record's own title/training-type text, so the matrix stays usable once it grows past a page or two. */
export class ListTrainingRecordsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  q?: string
}
