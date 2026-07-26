import { BadRequestException } from '@nestjs/common'

export interface SortOrder {
  field: string
  direction: 'asc' | 'desc'
}

/**
 * Parses a `?sort=field:asc|desc` query value against a per-endpoint
 * allow-list, throwing a 400 rather than letting an arbitrary column name
 * reach the database layer.
 */
export function resolveSort(
  sort: string | undefined,
  allowedFields: readonly string[],
  fallback: SortOrder,
): SortOrder {
  if (!sort) {
    return fallback
  }

  const [field, direction = 'asc'] = sort.split(':')

  if (!allowedFields.includes(field)) {
    throw new BadRequestException(
      `Invalid sort field "${field}". Allowed fields: ${allowedFields.join(', ')}`,
    )
  }

  if (direction !== 'asc' && direction !== 'desc') {
    throw new BadRequestException(`Invalid sort direction "${direction}". Allowed: asc, desc`)
  }

  return { field, direction }
}
