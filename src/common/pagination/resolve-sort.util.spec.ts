import { BadRequestException } from '@nestjs/common'

import { resolveSort } from './resolve-sort.util'

describe('resolveSort', () => {
  const fallback = { field: 'createdAt', direction: 'desc' } as const

  it('returns the fallback when no sort is given', () => {
    expect(resolveSort(undefined, ['name'], fallback)).toEqual(fallback)
  })

  it('parses field:direction', () => {
    expect(resolveSort('name:asc', ['name'], fallback)).toEqual({ field: 'name', direction: 'asc' })
  })

  it('defaults to asc when no direction is given', () => {
    expect(resolveSort('name', ['name'], fallback)).toEqual({ field: 'name', direction: 'asc' })
  })

  it('rejects a field not on the allow-list', () => {
    expect(() => resolveSort('password:asc', ['name'], fallback)).toThrow(BadRequestException)
  })

  it('rejects an invalid direction', () => {
    expect(() => resolveSort('name:sideways', ['name'], fallback)).toThrow(BadRequestException)
  })
})
