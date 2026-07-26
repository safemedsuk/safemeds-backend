import { paginate } from './paginate.util'

describe('paginate', () => {
  it('computes totalPages from total and limit', () => {
    const result = paginate(['a', 'b'], 45, { page: 2, limit: 20 })

    expect(result.data).toEqual(['a', 'b'])
    expect(result.meta).toEqual({ page: 2, limit: 20, total: 45, totalPages: 3 })
  })

  it('defaults page and limit when not provided', () => {
    const result = paginate([], 0, {} as { page: number; limit: number })

    expect(result.meta.page).toBe(1)
    expect(result.meta.limit).toBe(25)
  })

  it('returns zero totalPages for an empty result set', () => {
    const result = paginate([], 0, { page: 1, limit: 25 })

    expect(result.meta.totalPages).toBe(0)
  })
})
