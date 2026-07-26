import { PaginatedResult } from './paginated-result'
import { PaginationQueryDto } from './pagination-query.dto'

export function paginate<T>(
  items: T[],
  total: number,
  query: Pick<PaginationQueryDto, 'page' | 'limit'>,
): PaginatedResult<T> {
  const page = query.page ?? 1
  const limit = query.limit ?? 25
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0

  return new PaginatedResult(items, { page, limit, total, totalPages })
}
