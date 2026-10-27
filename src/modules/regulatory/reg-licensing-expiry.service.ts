import { Injectable } from '@nestjs/common'

import { NotificationParams, NotificationType } from '../../common/i18n/notification-content'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { TasksService } from '../tasks/tasks.service'

const APPROACHING_WINDOW_MS = 90 * 24 * 60 * 60 * 1000 // 90 days — a licence/permit renewal cycle is much shorter than a 5-year registration renewal, so one earlier warning window is enough (vs. `RegDeadline`'s 180/90/30-day triple).

/**
 * RegCloud (Phase 12) Stage 10 (Facility/Personnel licensing) + Stage 11
 * (Import/Export permits) — a direct scan against each record's own
 * `licenceExpiresOn`/`expiresOn`/`validTo` field, deliberately **not**
 * routed through `RegDeadline`/`RegDeadlineRule` for any of the three,
 * kept uniform on purpose: a facility's premises licence has no single
 * natural `RegulatoryAuthority` to key a rule off (a country can have
 * several — Kenya's PPB, NVIP, and the synthetic Ethics Committee
 * authority all coexist), and while an import/export permit *does* carry
 * an unambiguous `authorityId`, routing just that one record type
 * through a second escalation mechanism for no real benefit would be
 * inconsistent for no reason. The tenant's own directly-entered expiry
 * date is always authoritative and always present once a
 * licence/permit is actually issued, so a plain date comparison is both
 * simpler and more honest than an inferred computation here.
 */
@Injectable()
export class RegLicensingExpiryService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly tasksService: TasksService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async scan(): Promise<{ expired: number; approaching: number }> {
    const now = new Date()
    const approachingBy = new Date(now.getTime() + APPROACHING_WINDOW_MS)
    let expired = 0
    let approaching = 0

    // ── Facilities ──
    const expiredFacilities = await this.rls.runWithSystemAccess((tx) =>
      tx.facility.findMany({
        where: { licenceStatus: { not: 'expired' }, licenceExpiresOn: { lt: now, not: null } },
      }),
    )
    for (const facility of expiredFacilities) {
      await this.rls.runAsCompany(facility.companyId, async (tx) => {
        await tx.facility.update({ where: { id: facility.id }, data: { licenceStatus: 'expired' } })
        await this.auditService.log(tx, {
          companyId: facility.companyId,
          actorType: 'system',
          action: 'facility_licence_expired',
          recordType: 'facility',
          recordId: facility.id,
          newValue: { licenceExpiresOn: facility.licenceExpiresOn!.toISOString() },
        })
      })
      await this.escalate(
        facility.companyId,
        'facility',
        facility.id,
        'overdue',
        `Facility licence EXPIRED: ${facility.name} (licence ${facility.licenceNumber ?? 'unnumbered'})`,
        'licensing_facility',
        { overdue: true, name: facility.name, licenceNumber: facility.licenceNumber ?? undefined },
      )
      expired += 1
    }

    const approachingFacilities = await this.rls.runWithSystemAccess((tx) =>
      tx.facility.findMany({
        where: {
          licenceStatus: { not: 'expired' },
          licenceExpiresOn: { gte: now, lte: approachingBy },
          licenceRenewalNotifiedAt: null,
        },
      }),
    )
    for (const facility of approachingFacilities) {
      await this.rls.runAsCompany(facility.companyId, (tx) =>
        tx.facility.update({ where: { id: facility.id }, data: { licenceRenewalNotifiedAt: now } }),
      )
      await this.escalate(
        facility.companyId,
        'facility',
        facility.id,
        'due_soon',
        `Facility licence renewal approaching: ${facility.name}, due ${facility.licenceExpiresOn!.toISOString().slice(0, 10)}`,
        'licensing_facility',
        {
          overdue: false,
          name: facility.name,
          dueDate: facility.licenceExpiresOn!.toISOString().slice(0, 10),
        },
      )
      approaching += 1
    }

    // ── Personnel ──
    const expiredPersonnel = await this.rls.runWithSystemAccess((tx) =>
      tx.personnelLicence.findMany({
        where: { status: { not: 'expired' }, expiresOn: { lt: now, not: null } },
      }),
    )
    for (const licence of expiredPersonnel) {
      await this.rls.runAsCompany(licence.companyId, async (tx) => {
        await tx.personnelLicence.update({ where: { id: licence.id }, data: { status: 'expired' } })
        await this.auditService.log(tx, {
          companyId: licence.companyId,
          actorType: 'system',
          action: 'personnel_licence_expired',
          recordType: 'personnel_licence',
          recordId: licence.id,
          newValue: { expiresOn: licence.expiresOn!.toISOString() },
        })
      })
      await this.escalate(
        licence.companyId,
        'personnel_licence',
        licence.id,
        'overdue',
        `Personnel licence EXPIRED: ${licence.licenceType} (${licence.licenceNumber})`,
        'licensing_personnel',
        { overdue: true, licenceType: licence.licenceType, licenceNumber: licence.licenceNumber },
      )
      expired += 1
    }

    const approachingPersonnel = await this.rls.runWithSystemAccess((tx) =>
      tx.personnelLicence.findMany({
        where: {
          status: { not: 'expired' },
          expiresOn: { gte: now, lte: approachingBy },
          renewalNotifiedAt: null,
        },
      }),
    )
    for (const licence of approachingPersonnel) {
      await this.rls.runAsCompany(licence.companyId, (tx) =>
        tx.personnelLicence.update({ where: { id: licence.id }, data: { renewalNotifiedAt: now } }),
      )
      await this.escalate(
        licence.companyId,
        'personnel_licence',
        licence.id,
        'due_soon',
        `Personnel licence renewal approaching: ${licence.licenceType} (${licence.licenceNumber}), due ${licence.expiresOn!.toISOString().slice(0, 10)}`,
        'licensing_personnel',
        {
          overdue: false,
          licenceType: licence.licenceType,
          licenceNumber: licence.licenceNumber,
          dueDate: licence.expiresOn!.toISOString().slice(0, 10),
        },
      )
      approaching += 1
    }

    // ── Import/Export permits ──
    const expiredPermits = await this.rls.runWithSystemAccess((tx) =>
      tx.importExportPermit.findMany({
        where: { status: { not: 'expired' }, validTo: { lt: now, not: null } },
      }),
    )
    for (const permit of expiredPermits) {
      await this.rls.runAsCompany(permit.companyId, async (tx) => {
        await tx.importExportPermit.update({
          where: { id: permit.id },
          data: { status: 'expired' },
        })
        await this.auditService.log(tx, {
          companyId: permit.companyId,
          actorType: 'system',
          action: 'import_export_permit_expired',
          recordType: 'import_export_permit',
          recordId: permit.id,
          newValue: { validTo: permit.validTo!.toISOString() },
        })
      })
      await this.escalate(
        permit.companyId,
        'import_export_permit',
        permit.id,
        'overdue',
        `Import/export permit EXPIRED: ${permit.permitType} (${permit.permitNumber ?? 'unnumbered'})`,
        'licensing_permit',
        {
          overdue: true,
          permitType: permit.permitType,
          permitNumber: permit.permitNumber ?? undefined,
        },
      )
      expired += 1
    }

    const approachingPermits = await this.rls.runWithSystemAccess((tx) =>
      tx.importExportPermit.findMany({
        where: {
          status: { not: 'expired' },
          validTo: { gte: now, lte: approachingBy },
          renewalNotifiedAt: null,
        },
      }),
    )
    for (const permit of approachingPermits) {
      await this.rls.runAsCompany(permit.companyId, (tx) =>
        tx.importExportPermit.update({
          where: { id: permit.id },
          data: { renewalNotifiedAt: now },
        }),
      )
      await this.escalate(
        permit.companyId,
        'import_export_permit',
        permit.id,
        'due_soon',
        `Import/export permit renewal approaching: ${permit.permitType} (${permit.permitNumber ?? 'unnumbered'}), due ${permit.validTo!.toISOString().slice(0, 10)}`,
        'licensing_permit',
        {
          overdue: false,
          permitType: permit.permitType,
          permitNumber: permit.permitNumber ?? undefined,
          dueDate: permit.validTo!.toISOString().slice(0, 10),
        },
      )
      approaching += 1
    }

    return { expired, approaching }
  }

  private async escalate(
    companyId: string,
    recordType: string,
    recordId: string,
    urgency: 'due_soon' | 'overdue',
    title: string,
    type: NotificationType,
    params: NotificationParams,
  ): Promise<void> {
    await this.tasksService.escalateForRecord(companyId, recordType, recordId, urgency, title, {})

    const recipients = await this.rls.runAsCompany(companyId, (tx) =>
      tx.user.findMany({
        where: { companyId, roleKeys: { has: 'REGULATORY_AFFAIRS_OFFICER' }, status: 'active' },
        select: { id: true, email: true },
      }),
    )
    for (const recipient of recipients) {
      await this.notificationsService.create({
        companyId,
        userId: recipient.id,
        category: urgency === 'overdue' ? 'deadline_breached' : 'deadline_approaching',
        title,
        body: `${title}. Record: ${recordType}/${recordId}.`,
        type,
        params: { ...params, recordType, recordId },
        recordType,
        recordId,
      })
    }
  }
}
