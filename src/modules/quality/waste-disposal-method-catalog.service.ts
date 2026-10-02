import { Injectable, NotFoundException } from '@nestjs/common'
import { WasteDisposalMethodCatalogEntry } from '@prisma/client'

import { newId } from '../../common/id'
import { RlsService } from '../../common/rls/rls.service'
import { UpsertWasteDisposalMethodDto } from './dto/upsert-waste-disposal-method.dto'

/**
 * QualCloud (Phase 13) Stage 15 — the admin-configurable waste-disposal
 * method catalog. Platform-wide reference data, no RLS, mirroring
 * `TrainingTypeCatalogEntry`'s own exact precedent. Gated
 * `platform.config.manage` on the controller, same as every other
 * platform-admin-editable catalog in this codebase
 * (`AuditRequirementDefinition`, `InspectionChecklistTemplate`).
 */
@Injectable()
export class WasteDisposalMethodCatalogService {
  constructor(private readonly rls: RlsService) {}

  async list(): Promise<WasteDisposalMethodCatalogEntry[]> {
    return this.rls.runWithSystemAccess((tx) =>
      tx.wasteDisposalMethodCatalogEntry.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] }),
    )
  }

  async listActive(): Promise<WasteDisposalMethodCatalogEntry[]> {
    return this.rls.runWithSystemAccess((tx) =>
      tx.wasteDisposalMethodCatalogEntry.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      }),
    )
  }

  /** Upsert on the natural key (`methodKey`) — never delete-then-recreate, matching this project's own established seed/admin-edit discipline. */
  async upsert(dto: UpsertWasteDisposalMethodDto): Promise<WasteDisposalMethodCatalogEntry> {
    return this.rls.runWithSystemAccess((tx) =>
      tx.wasteDisposalMethodCatalogEntry.upsert({
        where: { methodKey: dto.methodKey },
        create: {
          id: newId(),
          methodKey: dto.methodKey,
          label: dto.label,
          sortOrder: dto.sortOrder ?? 0,
          active: dto.active ?? true,
        },
        update: {
          label: dto.label,
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      }),
    )
  }

  async deactivate(id: string): Promise<WasteDisposalMethodCatalogEntry> {
    return this.rls.runWithSystemAccess(async (tx) => {
      const existing = await tx.wasteDisposalMethodCatalogEntry.findUnique({ where: { id } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Waste disposal method not found' })
      return tx.wasteDisposalMethodCatalogEntry.update({ where: { id }, data: { active: false } })
    })
  }
}
