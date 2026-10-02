import { ForbiddenException, Injectable } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'

export interface ObligationFeedItem {
  module: 'vigicloud' | 'regulatory' | 'qualcloud'
  kind: string
  label: string
  dueAt: string
  recordType: string
  recordId: string
  overdue: boolean
}

const FEED_ROW_CAP = 50
/** How far ahead (and how far back, for already-overdue items) this feed looks — matching `DUE_SOON_HORIZON_DAYS`'s own established precedent in `DashboardService`. */
const LOOKBACK_LOOKAHEAD_DAYS = 90

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'The obligations feed is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 20 — Deadlines/Obligations, across every
 * module. Genuinely **not** a new deadline engine — a single,
 * read-only composition over clocks that already exist in this
 * schema: VigiCloud's `Deadline` (reporting deadlines),
 * RegCloud's `RegDeadline` (registration renewals) and
 * `RegPostMarketObligation`, and QualCloud's own `Capa.dueDate`,
 * `Equipment.calibrationDueAt`/`maintenanceDueAt`, and
 * `TrainingRecord.expiryDate` — each queried directly, in one
 * transaction, never re-derived or duplicated into a new table.
 */
@Injectable()
export class ObligationsFeedService {
  constructor(private readonly rls: RlsService) {}

  async getFeed(actor: AuthenticatedUser): Promise<ObligationFeedItem[]> {
    const companyId = requireCompany(actor)
    const now = new Date()
    const windowStart = new Date(now.getTime() - LOOKBACK_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000)
    const windowEnd = new Date(now.getTime() + LOOKBACK_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000)
    const inWindow = { gte: windowStart, lte: windowEnd }

    return this.rls.runAsCompany(companyId, async (tx) => {
      const [
        vigiDeadlines,
        regDeadlines,
        postMarketObligations,
        capas,
        equipmentRows,
        trainingRows,
      ] = await Promise.all([
        tx.deadline.findMany({
          where: { companyId, status: 'pending', dueAt: inWindow },
          take: FEED_ROW_CAP,
        }),
        tx.regDeadline.findMany({
          where: { companyId, status: 'pending', dueAt: inWindow },
          take: FEED_ROW_CAP,
        }),
        tx.regPostMarketObligation.findMany({
          where: { companyId, status: { in: ['pending', 'overdue'] }, dueAt: inWindow },
          include: { productRegistration: { select: { registrationNumber: true } } },
          take: FEED_ROW_CAP,
        }),
        tx.capa.findMany({
          where: { companyId, status: { not: 'closed' }, dueDate: inWindow },
          take: FEED_ROW_CAP,
        }),
        tx.equipment.findMany({
          where: {
            companyId,
            isActive: true,
            OR: [{ calibrationDueAt: inWindow }, { maintenanceDueAt: inWindow }],
          },
          take: FEED_ROW_CAP,
        }),
        tx.trainingRecord.findMany({
          where: { companyId, expiryDate: inWindow },
          take: FEED_ROW_CAP,
        }),
      ])

      const items: ObligationFeedItem[] = []

      for (const d of vigiDeadlines) {
        items.push({
          module: 'vigicloud',
          kind: 'pv_reporting_deadline',
          label: `PV reporting deadline — ${d.recordType}`,
          dueAt: d.dueAt.toISOString(),
          recordType: d.recordType,
          recordId: d.recordId,
          overdue: d.dueAt < now,
        })
      }
      for (const d of regDeadlines) {
        items.push({
          module: 'regulatory',
          kind: 'reg_renewal_deadline',
          label: `Registration renewal deadline — ${d.recordType}`,
          dueAt: d.dueAt.toISOString(),
          recordType: d.recordType,
          recordId: d.recordId,
          overdue: d.dueAt < now,
        })
      }
      for (const o of postMarketObligations) {
        items.push({
          module: 'regulatory',
          kind: 'post_market_obligation',
          label: `${o.obligationType.replace(/_/g, ' ')} — ${o.productRegistration.registrationNumber}`,
          dueAt: o.dueAt.toISOString(),
          recordType: 'product_registration',
          recordId: o.productRegistrationId,
          overdue: o.dueAt < now,
        })
      }
      for (const c of capas) {
        if (!c.dueDate) continue
        items.push({
          module: 'qualcloud',
          kind: 'capa_due',
          label: `CAPA due — ${c.title}`,
          dueAt: c.dueDate.toISOString(),
          recordType: 'capa',
          recordId: c.id,
          overdue: c.dueDate < now,
        })
      }
      for (const e of equipmentRows) {
        if (e.calibrationDueAt && e.calibrationDueAt >= windowStart && e.calibrationDueAt <= windowEnd) {
          items.push({
            module: 'qualcloud',
            kind: 'equipment_calibration',
            label: `${e.name} — calibration due`,
            dueAt: e.calibrationDueAt.toISOString(),
            recordType: 'equipment',
            recordId: e.id,
            overdue: e.calibrationDueAt < now,
          })
        }
        if (e.maintenanceDueAt && e.maintenanceDueAt >= windowStart && e.maintenanceDueAt <= windowEnd) {
          items.push({
            module: 'qualcloud',
            kind: 'equipment_maintenance',
            label: `${e.name} — maintenance due`,
            dueAt: e.maintenanceDueAt.toISOString(),
            recordType: 'equipment',
            recordId: e.id,
            overdue: e.maintenanceDueAt < now,
          })
        }
      }
      for (const t of trainingRows) {
        if (!t.expiryDate) continue
        items.push({
          module: 'qualcloud',
          kind: 'training_renewal',
          label: `Training renewal due — ${t.title} (${t.trainingType})`,
          dueAt: t.expiryDate.toISOString(),
          recordType: 'training_record',
          recordId: t.id,
          overdue: t.expiryDate < now,
        })
      }

      return items.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()).slice(0, FEED_ROW_CAP)
    })
  }
}
