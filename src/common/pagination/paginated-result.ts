import { PaginationMeta } from './pagination-meta.interface'

export class PaginatedResult<T> {
  constructor(
    public readonly data: T[],
    public readonly meta: PaginationMeta,
  ) {}
}
