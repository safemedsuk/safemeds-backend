import { Injectable } from '@nestjs/common'
import { WhoDrugTerm } from '@prisma/client'

import { PrismaService } from '../../prisma/prisma.service'
import { SearchWhoDrugQueryDto } from './dto/search-who-drug-query.dto'

const TYPEAHEAD_LIMIT = 20

/**
 * VigiCloud Stage 7 — the WHODrug Global counterpart to `MeddraService`,
 * same shape exactly: global reference data (no `companyId`), trigram
 * typeahead search over `name`, versioned so a coded term is always
 * traceable to the dictionary release used at coding time.
 */
@Injectable()
export class WhoDrugService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: SearchWhoDrugQueryDto): Promise<WhoDrugTerm[]> {
    const version = query.version
      ? await this.prisma.whoDrugVersion.findUnique({ where: { versionLabel: query.version } })
      : await this.prisma.whoDrugVersion.findFirst({ orderBy: { releasedOn: 'desc' } })

    if (!version) {
      return []
    }

    return this.prisma.whoDrugTerm.findMany({
      where: {
        versionId: version.id,
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { substanceName: { contains: query.q, mode: 'insensitive' } },
        ],
      },
      orderBy: { name: 'asc' },
      take: TYPEAHEAD_LIMIT,
    })
  }
}
