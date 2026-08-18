import { Injectable } from '@nestjs/common'
import { MeddraTerm } from '@prisma/client'

import { PrismaService } from '../../prisma/prisma.service'
import { SearchMeddraQueryDto } from './dto/search-meddra-query.dto'

const TYPEAHEAD_LIMIT = 20

/**
 * Global reference data (no `companyId`, shared by every tenant — same as
 * `Country`/`RegulatoryAuthority`), so this goes through plain
 * `PrismaService` directly, no `RlsService` involved, matching the Phase 4
 * `CountryConfigService` precedent for non-tenant-owned tables.
 */
@Injectable()
export class MeddraService {
  constructor(private readonly prisma: PrismaService) {}

  /** Typeahead search — trigram-indexed `ILIKE` on `name` (phase7_1 migration's `meddra_term_name_trgm_idx`), capped tight since this backs an autocomplete, not a browsable list. */
  async search(query: SearchMeddraQueryDto): Promise<MeddraTerm[]> {
    const version = query.version
      ? await this.prisma.meddraVersion.findUnique({ where: { versionLabel: query.version } })
      : await this.prisma.meddraVersion.findFirst({ orderBy: { releasedOn: 'desc' } })

    if (!version) {
      return []
    }

    return this.prisma.meddraTerm.findMany({
      where: {
        versionId: version.id,
        name: { contains: query.q, mode: 'insensitive' },
        ...(query.level ? { level: query.level } : {}),
      },
      orderBy: { name: 'asc' },
      take: TYPEAHEAD_LIMIT,
    })
  }
}
