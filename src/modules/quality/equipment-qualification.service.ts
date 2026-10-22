import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { EquipmentQualificationEvent, MaintenanceRecord } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { TasksService } from '../tasks/tasks.service'
import {
  CreateMaintenanceRecordDto,
  RecordEquipmentQualificationEventDto,
} from './dto/equipment-qualification.dto'

export interface RequestMeta {
  ip?: string
}

export const EQUIPMENT_RECORD_TYPE = 'equipment'

/** EU GMP Annex 15/ISPE's own four-step order — advancing `Equipment.qualificationStatus` only moves forward along this sequence, matching `qualificationStatus`'s own schema doc comment enum. */
const STAGE_STATUS: Record<string, string> = {
  dq: 'dq_complete',
  iq: 'iq_complete',
  oq: 'oq_complete',
  pq: 'qualified',
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Equipment qualification is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 14 — Equipment & Facility Qualification,
 * Calibration, Maintenance. Builds on `EquipmentService`'s existing bare
 * CRUD (Stage 0.1): each DQ/IQ/OQ/PQ step is recorded as its own dated,
 * attributed event (`EquipmentQualificationEvent`), not a bare status
 * flip — `Equipment.qualificationStatus` is advanced here as the live
 * denormalized summary, exactly matching `Sop.status`'s own
 * "service/workflow writes it, nothing else does" discipline (this
 * record type has no `WorkflowInstance` behind it — a qualification
 * step is a one-shot dated event, not a multi-actor lifecycle, the same
 * reasoning `BatchRecordReview` already established for a comparable
 * single-shot QA action).
 */
@Injectable()
export class EquipmentQualificationService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly tasksService: TasksService,
    private readonly documentsService: DocumentsService,
  ) {}

  /**
   * Pass B (item C3) — uploads a validation report against an equipment
   * item. The DQ/IQ/OQ/PQ event that cites it is recorded afterwards, so
   * the report always exists before the step it evidences.
   */
  async attachValidationReport(
    actor: AuthenticatedUser,
    equipmentId: string,
    file: DirectUploadFile,
    meta: RequestMeta,
  ) {
    const companyId = requireCompany(actor)
    const equipment = await this.rls.runAsCompany(companyId, (tx) =>
      tx.equipment.findFirst({
        where: { id: equipmentId, companyId },
        select: { id: true, name: true },
      }),
    )
    if (!equipment)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Equipment not found' })
    const uploaded = await this.documentsService.uploadDirect(
      actor,
      EQUIPMENT_RECORD_TYPE,
      equipmentId,
      file,
      { title: `Validation report — ${equipment.name} — ${new Date().toISOString().slice(0, 10)}` },
      meta,
    )
    await this.rls.runAsCompany(companyId, (tx) =>
      this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'equipment_validation_report_attached',
        recordType: EQUIPMENT_RECORD_TYPE,
        recordId: equipmentId,
        newValue: { documentId: uploaded.document.id, filename: file.originalname },
        ip: meta.ip,
      }),
    )
    return { documentId: uploaded.document.id, title: uploaded.document.title }
  }

  async recordEvent(
    actor: AuthenticatedUser,
    equipmentId: string,
    dto: RecordEquipmentQualificationEventDto,
    meta: RequestMeta,
  ): Promise<EquipmentQualificationEvent> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const equipment = await tx.equipment.findFirst({ where: { id: equipmentId, companyId } })
      if (!equipment)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Equipment not found' })

      const result = dto.result ?? 'pass'
      // Pass B (item C3): a passing step must cite a validation report that was
      // uploaded against this equipment before the step is recorded.
      if (result === 'pass') {
        if (!dto.reportDocumentId) {
          throw new BadRequestException({
            code: 'VALIDATION_REPORT_REQUIRED',
            message: 'Attach the validation report for this step before recording it as passed.',
          })
        }
        const report = await tx.document.findFirst({
          where: {
            id: dto.reportDocumentId,
            companyId,
            recordType: EQUIPMENT_RECORD_TYPE,
            recordId: equipmentId,
          },
        })
        if (!report) {
          throw new BadRequestException({
            code: 'VALIDATION_REPORT_NOT_FOUND',
            message:
              'That validation report is not attached to this equipment. Upload it for this equipment first.',
          })
        }
      }
      const created = await tx.equipmentQualificationEvent.create({
        data: {
          id: newId(),
          companyId,
          equipmentId,
          stage: dto.stage,
          protocolDocumentId: dto.protocolDocumentId ?? null,
          reportDocumentId: dto.reportDocumentId ?? null,
          result,
          notes: dto.notes ?? null,
          performedBy: actor.sub,
        },
      })

      // Only a pass advances the live summary status — a failed step
      // leaves `qualificationStatus` exactly where it was, so a failed
      // IQ doesn't silently look like a passed one on the register.
      if (result === 'pass') {
        await tx.equipment.update({
          where: { id: equipmentId },
          data: { qualificationStatus: STAGE_STATUS[dto.stage] ?? equipment.qualificationStatus },
        })
      }

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'equipment_qualification_event_recorded',
        recordType: EQUIPMENT_RECORD_TYPE,
        recordId: equipmentId,
        newValue: { stage: dto.stage, result },
        ip: meta.ip,
      })

      return created
    })
  }

  async listEvents(
    actor: AuthenticatedUser,
    equipmentId: string,
  ): Promise<EquipmentQualificationEvent[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.equipmentQualificationEvent.findMany({
        where: { companyId, equipmentId },
        orderBy: { performedAt: 'asc' },
      }),
    )
  }

  async recordMaintenance(
    actor: AuthenticatedUser,
    equipmentId: string,
    dto: CreateMaintenanceRecordDto,
    meta: RequestMeta,
  ): Promise<MaintenanceRecord> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const equipment = await tx.equipment.findFirst({ where: { id: equipmentId, companyId } })
      if (!equipment)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Equipment not found' })

      const nextDueAt = dto.nextDueAt ? new Date(dto.nextDueAt) : null
      const created = await tx.maintenanceRecord.create({
        data: {
          id: newId(),
          companyId,
          equipmentId,
          maintenanceDate: new Date(dto.maintenanceDate),
          description: dto.description,
          performedBy: actor.sub,
          nextDueAt,
          createdBy: actor.sub,
        },
      })

      await tx.equipment.update({
        where: { id: equipmentId },
        data: { maintenanceDueAt: nextDueAt ?? equipment.maintenanceDueAt },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'equipment_maintenance_recorded',
        recordType: EQUIPMENT_RECORD_TYPE,
        recordId: equipmentId,
        newValue: { description: dto.description, nextDueAt },
        ip: meta.ip,
      })

      return created
    })
  }

  async listMaintenance(
    actor: AuthenticatedUser,
    equipmentId: string,
  ): Promise<MaintenanceRecord[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.maintenanceRecord.findMany({
        where: { companyId, equipmentId },
        orderBy: { maintenanceDate: 'desc' },
      }),
    )
  }

  /**
   * The daily calibration/maintenance-due scan — the first real instance
   * in this codebase of "overdue X creates a real deviation candidate."
   * Deliberately **offers** rather than auto-creates a `Deviation`: a
   * `Deviation` is a regulated, attributed record (`raisedBy`/
   * `createdBy` are real actor FKs, and creation also instantiates a
   * real `WorkflowInstance`) with no honest system-actor concept
   * anywhere else in this schema to attribute it to — a scope decision
   * made explicitly rather than inventing a synthetic actor. A real
   * `Task` (the same overdue-escalation primitive every other scan in
   * this codebase already uses) is opened instead, pointing a quality
   * user at the specific overdue equipment so they can open the
   * deviation themselves with a real human `raisedBy`.
   */
  async escalateOverdue(): Promise<{ flagged: number }> {
    const now = new Date()
    const overdue = await this.rls.runWithSystemAccess((tx) =>
      tx.equipment.findMany({
        where: {
          isActive: true,
          OR: [{ calibrationDueAt: { lt: now } }, { maintenanceDueAt: { lt: now } }],
        },
        select: {
          id: true,
          companyId: true,
          name: true,
          calibrationDueAt: true,
          maintenanceDueAt: true,
        },
      }),
    )

    for (const eq of overdue) {
      const reason =
        eq.calibrationDueAt && eq.calibrationDueAt < now
          ? 'calibration overdue'
          : 'maintenance overdue'
      await this.tasksService.escalateForRecord(
        eq.companyId,
        EQUIPMENT_RECORD_TYPE,
        eq.id,
        'overdue',
        `${eq.name} is ${reason} — open a deviation if this affects product quality`,
        {},
      )
    }

    return { flagged: overdue.length }
  }
}
