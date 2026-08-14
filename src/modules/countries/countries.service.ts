import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { paginate, PaginatedResult, PaginationQueryDto, resolveSort } from '../../common/pagination'
import { PrismaService } from '../../prisma/prisma.service'

export interface CountryDto {
  id: string
  isoCode: string
  name: string
}

const SORTABLE_FIELDS = ['name', 'isoCode'] as const

export interface ListCountriesQuery extends PaginationQueryDto {
  /** Only countries with at least one RegulatoryAuthority configured (Phase 4.1) — the country-picker for a Kenya-first platform where most markets aren't built out yet. */
  configured?: boolean
}

@Injectable()
export class CountriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListCountriesQuery): Promise<PaginatedResult<CountryDto>> {
    const sort = resolveSort(query.sort, SORTABLE_FIELDS, { field: 'name', direction: 'asc' })
    const where: Prisma.CountryWhereInput = query.configured
      ? { regulatoryAuthorities: { some: {} } }
      : {}

    const [rows, total] = await Promise.all([
      this.prisma.country.findMany({
        where,
        orderBy: { [sort.field]: sort.direction },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.country.count({ where }),
    ])

    return paginate(rows, total, query)
  }
}
