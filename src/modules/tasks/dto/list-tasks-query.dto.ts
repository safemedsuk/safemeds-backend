import { IsIn, IsOptional, IsString } from 'class-validator'

import { PaginationQueryDto } from '../../../common/pagination'

export class ListTasksQueryDto extends PaginationQueryDto {
  /** me = assigned to or claimed by the caller; role = open in any of the caller's role queues; all = both, plus closed if requested via status. */
  @IsOptional()
  @IsIn(['me', 'role', 'all'])
  scope?: 'me' | 'role' | 'all'

  @IsOptional()
  @IsString()
  recordType?: string

  /** Special Corner SC-6 — powers a "Tasks for this record" panel on a record's own detail page. Combine with `scope=all` to see every task tied to this record regardless of who it's assigned/claimed to, not just the caller's own. */
  @IsOptional()
  @IsString()
  recordId?: string

  @IsOptional()
  @IsIn(['normal', 'due_soon', 'overdue'])
  urgency?: string

  @IsOptional()
  @IsIn(['open', 'claimed', 'closed'])
  status?: string
}
