import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../prisma/prisma.service'

export interface ReportTypeDto {
  id: string
  typeKey: string
  name: string
  moduleKey: string
}

/**
 * VigiCloud Stage 0.10 — a small, bounded reference catalog (today: the
 * six Kenyan PV report types), the same category as `RolesService`'s
 * role catalog — not paginated, since it's not an operational dataset
 * that grows without bound the way audit/task data does.
 */
@Injectable()
export class ReportTypesService {
  constructor(private readonly prisma: PrismaService) {}

  list(moduleKey?: string): Promise<ReportTypeDto[]> {
    return this.prisma.reportType.findMany({
      where: moduleKey ? { moduleKey } : undefined,
      orderBy: { name: 'asc' },
    })
  }
}
