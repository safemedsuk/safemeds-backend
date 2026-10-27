import { Injectable, OnModuleInit } from '@nestjs/common'

import { NotificationsService } from '../notifications/notifications.service'
import { TrainingComplianceService } from '../training/training-compliance.service'
import { WorkflowGuardRegistryService } from '../workflow/workflow-guard-registry.service'
import { WorkflowStatusSyncRegistryService } from '../workflow/workflow-status-sync-registry.service'
import { QUALITY_CHANGE_CONTROL_RECORD_TYPE, requiredApproverRoles } from './change-control.service'
import { QUALITY_COMPLAINT_RECORD_TYPE } from './complaint.service'
import {
  DEVIATION_INVESTIGATION_DUE_DAYS,
  QUALITY_DEVIATION_RECORD_TYPE,
} from './deviation.service'
import { investigationDocumentRecordType } from './deviation.service'
import { OOS_MANUFACTURING_REPORT_RECORD_TYPE, QUALITY_OOS_RECORD_TYPE } from './oos.service'
import { QUALITY_CONTROLLED_DOCUMENT_RECORD_TYPE } from './sop.service'

const OPEN_CAPA_STATUSES = ['open', 'in_progress', 'pending_effectiveness_check'] as const
const VALID_SEVERITIES = ['critical', 'major', 'minor'] as const

/**
 * QualCloud (Phase 13) Stages 1/2/4/5/6 — every `quality_controlled_document`
 * (Sop), `quality_deviation`, `quality_change_control`, `quality_complaint`,
 * and `quality_oos` workflow guard/status-sync lives here, registered
 * against the shared `WorkflowGuardRegistryService`/
 * `WorkflowStatusSyncRegistryService`, mirroring `PvWorkflowGuards`'
 * own exact shape (VigiCloud Stage 3.7+).
 */
@Injectable()
export class QualityWorkflowGuards implements OnModuleInit {
  constructor(
    private readonly guardRegistry: WorkflowGuardRegistryService,
    private readonly statusSyncRegistry: WorkflowStatusSyncRegistryService,
    private readonly notificationsService: NotificationsService,
    private readonly trainingComplianceService: TrainingComplianceService,
  ) {}

  onModuleInit(): void {
    // ── Sop (Document Control) ─────────────────────────────────────────

    this.statusSyncRegistry.register(
      QUALITY_CONTROLLED_DOCUMENT_RECORD_TYPE,
      async ({ tx, recordId, toStateKey }) => {
        const sop = await tx.sop.findUnique({ where: { id: recordId } })
        if (!sop) return

        await tx.sop.update({
          where: { id: recordId },
          data: {
            status: toStateKey,
            ...(toStateKey === 'effective' ? { effectiveDate: new Date() } : {}),
          },
        })

        // Making a revised version effective supersedes the version it
        // replaces — a direct, system-owned write to the OLD document's
        // own status column and `WorkflowInstance`, not a normal
        // `WorkflowService.transition()` call (there is no human actor
        // "transitioning" the old document; this is a legitimate
        // system-triggered side effect of the *new* version going
        // effective — the same precedent `CaseFollowUpService
        // .reopenCaseToTriage()` already established for exactly this
        // class of override).
        if (toStateKey === 'effective' && sop.supersedesDocumentId) {
          const oldInstance = await tx.workflowInstance.findFirst({
            where: {
              recordType: QUALITY_CONTROLLED_DOCUMENT_RECORD_TYPE,
              recordId: sop.supersedesDocumentId,
            },
          })
          if (oldInstance) {
            const supersededState = await tx.workflowState.findFirst({
              where: { definitionId: oldInstance.definitionId, stateKey: 'superseded' },
            })
            if (supersededState) {
              await tx.workflowInstance.update({
                where: { id: oldInstance.id },
                data: { currentStateId: supersededState.id, enteredAt: new Date() },
              })
            }
          }
          await tx.sop.update({
            where: { id: sop.supersedesDocumentId },
            data: { status: 'superseded' },
          })
        }

        // QualCloud (Phase 13) Stage 12 — the real new-SOP-rollout side
        // effect: every active user holding a role whose curriculum
        // names this document's `documentType` as its rollout trigger
        // gets a real `DocumentAcknowledgment` row created here, inside
        // this same transaction, the moment the document goes
        // effective. See `TrainingComplianceService.rolloutForEffectiveSop()`'s
        // own doc comment.
        if (toStateKey === 'effective') {
          await this.trainingComplianceService.rolloutForEffectiveSop(tx, sop.companyId, sop)
        }
      },
    )

    // Never self-approval — the single most basic document-control
    // control any inspector checks first (`todo-qualcloud.md` Stage 1's
    // own explicit reasoning).
    this.guardRegistry.register(
      QUALITY_CONTROLLED_DOCUMENT_RECORD_TYPE,
      'in_review',
      async ({ tx, recordId, toStateKey, actorUserId }) => {
        if (toStateKey !== 'approved') return { allowed: true }
        const sop = await tx.sop.findUnique({ where: { id: recordId } })
        if (sop?.createdBy && sop.createdBy === actorUserId) {
          return {
            allowed: false,
            reason:
              "A controlled document's own author cannot also approve it — an independent QA approver is required.",
          }
        }
        return { allowed: true }
      },
    )

    // Retiring a controlled document — never deleted, but a reason is
    // required, matching this project's own established "reason
    // required" guard shape.
    this.guardRegistry.register(
      QUALITY_CONTROLLED_DOCUMENT_RECORD_TYPE,
      'effective',
      ({ toStateKey, note }) => {
        if (toStateKey !== 'retired') return Promise.resolve({ allowed: true })
        if (note && note.trim().length > 0) return Promise.resolve({ allowed: true })
        return Promise.resolve({
          allowed: false,
          reason: 'A reason is required to retire a controlled document.',
        })
      },
    )

    // ── Deviation ─────────────────────────────────────────────────────

    this.statusSyncRegistry.register(
      QUALITY_DEVIATION_RECORD_TYPE,
      async ({ tx, companyId, recordId, toStateKey, payload }) => {
        const deviation = await tx.deviation.findUnique({ where: { id: recordId } })
        if (!deviation) return

        const severity =
          toStateKey === 'classifying' && typeof payload?.severity === 'string'
            ? payload.severity
            : undefined

        const updated = await tx.deviation.update({
          where: { id: recordId },
          data: {
            status: toStateKey,
            ...(severity ? { severity } : {}),
            ...(severity
              ? {
                  investigationDueAt: new Date(
                    deviation.detectedAt.getTime() +
                      DEVIATION_INVESTIGATION_DUE_DAYS[severity] * 24 * 60 * 60 * 1000,
                  ),
                  // Pass A2 — a recomputed due date starts its reminder cycle again.
                  investigationReminderStage: null,
                }
              : {}),
            ...(toStateKey === 'closed' ? { closedAt: new Date() } : {}),
          },
        })

        // Real-time escalation on critical, not just a queued task — the
        // exact "auto-notifies QUALITY_MANAGER immediately" default
        // `todo-qualcloud.md` Stage 2 calls for. Permission-driven
        // fan-out (query `Role` by the permission it holds, then `User`
        // by `roleKeys`), mirroring `CaseFollowUpService
        // .resolveStaffRecipients()`'s own established shape, rather
        // than a hardcoded role-key list.
        if (severity === 'critical') {
          const roles = await tx.role.findMany({
            where: { permissions: { some: { permission: { key: 'quality.close_capa' } } } },
            select: { key: true },
          })
          const recipients =
            roles.length > 0
              ? await tx.user.findMany({
                  where: {
                    companyId,
                    roleKeys: { hasSome: roles.map((r) => r.key) },
                    status: 'active',
                  },
                  select: { id: true, email: true },
                })
              : []
          for (const recipient of recipients) {
            await this.notificationsService.create({
              companyId,
              userId: recipient.id,
              category: 'workflow_update',
              title: `Critical deviation raised: ${updated.deviationNumber}`,
              body: `"${updated.title}" was classified Critical and needs immediate attention.`,
              type: 'critical_deviation_raised',
              params: { deviationNumber: updated.deviationNumber, deviationTitle: updated.title },
              recordType: QUALITY_DEVIATION_RECORD_TYPE,
              recordId,
              email: { to: recipient.email },
            })
          }
        }
      },
    )

    // A severity must be given, and be a real value, before a deviation
    // can leave Detected — the classification step this transition
    // literally represents.
    this.guardRegistry.register(
      QUALITY_DEVIATION_RECORD_TYPE,
      'detected',
      ({ toStateKey, payload }) => {
        if (toStateKey !== 'classifying') return Promise.resolve({ allowed: true })
        const severity = payload?.severity
        if (
          typeof severity === 'string' &&
          (VALID_SEVERITIES as readonly string[]).includes(severity)
        ) {
          return Promise.resolve({ allowed: true })
        }
        return Promise.resolve({
          allowed: false,
          reason: 'A severity (critical, major, or minor) is required to classify this deviation.',
        })
      },
    )

    // Four-eyes on investigation review — the reviewer signing off the
    // investigation can never be the same person who performed it,
    // exactly the precedent VigiCloud Stage 9's own causality/QC
    // four-eyes rule already established.
    this.guardRegistry.register(
      QUALITY_DEVIATION_RECORD_TYPE,
      'investigating',
      async ({ tx, recordId, toStateKey, actorUserId }) => {
        if (toStateKey !== 'capa_pending') return { allowed: true }
        const investigation = await tx.investigation.findUnique({
          where: { deviationId: recordId },
        })
        if (investigation?.investigatorUserId && investigation.investigatorUserId === actorUserId) {
          return {
            allowed: false,
            reason:
              'The investigation reviewer cannot be the same person who performed the investigation.',
          }
        }
        return { allowed: true }
      },
    )

    // Pass A2 (item 4c) — the investigation report is a required, attached
    // document before the investigation can be completed. Mirrors the OOS
    // Phase-2 requirement below; the report is a separate document type from
    // the evidence the investigation accumulates along the way.
    this.guardRegistry.register(
      QUALITY_DEVIATION_RECORD_TYPE,
      'investigating',
      async ({ tx, companyId, recordId, toStateKey }) => {
        if (toStateKey !== 'capa_pending') return { allowed: true }
        const reports = await tx.document.count({
          where: {
            companyId,
            recordType: investigationDocumentRecordType('report'),
            recordId,
          },
        })
        if (reports === 0) {
          return {
            allowed: false,
            reason:
              'Attach the investigation report document before completing this investigation.',
          }
        }
        return { allowed: true }
      },
    )

    // Cannot close with an open CAPA — mirrors VigiCloud's own "cannot
    // close with open obligations" precedent on the PV case workflow
    // exactly. `sourceRecordType: 'deviation'` is `CapaService`'s own
    // generalized polymorphic link (Stage 0.3, Reconciliation Note 4).
    this.guardRegistry.register(
      QUALITY_DEVIATION_RECORD_TYPE,
      'capa_pending',
      async ({ tx, companyId, recordId }) => {
        const openCapa = await tx.capa.findFirst({
          where: {
            companyId,
            sourceRecordType: 'deviation',
            sourceRecordId: recordId,
            status: { in: [...OPEN_CAPA_STATUSES] },
          },
        })
        if (openCapa) {
          return {
            allowed: false,
            reason:
              'This deviation has an open CAPA — it must reach Closed before the deviation itself can close.',
          }
        }

        const noCapaAtAll = await tx.capa.count({
          where: { companyId, sourceRecordType: 'deviation', sourceRecordId: recordId },
        })
        if (noCapaAtAll === 0) {
          return {
            allowed: false,
            reason: 'This deviation needs a CAPA opened against it before it can close.',
          }
        }

        return { allowed: true }
      },
    )

    // ── Change Control ────────────────────────────────────────────────

    this.statusSyncRegistry.register(
      QUALITY_CHANGE_CONTROL_RECORD_TYPE,
      async ({ tx, recordId, toStateKey }) => {
        await tx.changeControl.update({
          where: { id: recordId },
          data: {
            status: toStateKey,
            ...(toStateKey === 'closed' ? { closedAt: new Date() } : {}),
          },
        })
      },
    )

    // The real cross-functional sign-off gate: every role the impact
    // assessment requires (`QUALITY_MANAGER` always, plus
    // `REGULATORY_AFFAIRS_OFFICER` once a regulatory impact is flagged)
    // must have already recorded its approval via `recordApproval()`.
    this.guardRegistry.register(
      QUALITY_CHANGE_CONTROL_RECORD_TYPE,
      'impact_assessment',
      async ({ tx, recordId, toStateKey }) => {
        if (toStateKey !== 'approved') return { allowed: true }
        const changeControl = await tx.changeControl.findUnique({ where: { id: recordId } })
        if (!changeControl) return { allowed: true }
        const required = requiredApproverRoles(changeControl.impactAssessment)
        const approvals = Array.isArray(changeControl.crossFunctionalApprovals)
          ? (changeControl.crossFunctionalApprovals as unknown as { role: string }[])
          : []
        const approvedRoles = new Set(approvals.map((a) => a.role))
        const missing = required.filter((role) => !approvedRoles.has(role))
        if (missing.length > 0) {
          return {
            allowed: false,
            reason: `This change control still needs approval from: ${missing.join(', ')}.`,
          }
        }
        return { allowed: true }
      },
    )

    // Cannot close until verification confirms no adverse effect.
    this.guardRegistry.register(
      QUALITY_CHANGE_CONTROL_RECORD_TYPE,
      'verifying',
      async ({ tx, recordId, toStateKey }) => {
        if (toStateKey !== 'closed') return { allowed: true }
        const changeControl = await tx.changeControl.findUnique({ where: { id: recordId } })
        if (
          !changeControl?.verificationResult ||
          changeControl.verificationResult.trim().length === 0
        ) {
          return {
            allowed: false,
            reason:
              'Verification must confirm no adverse effect (a non-empty verification result) before this change control can close.',
          }
        }
        return { allowed: true }
      },
    )

    // ── Complaint ─────────────────────────────────────────────────────

    this.statusSyncRegistry.register(
      QUALITY_COMPLAINT_RECORD_TYPE,
      async ({ tx, recordId, toStateKey }) => {
        await tx.complaint.update({ where: { id: recordId }, data: { status: toStateKey } })
      },
    )

    // ── OOS/OOT Investigation ───────────────────────────────────────────

    this.statusSyncRegistry.register(
      QUALITY_OOS_RECORD_TYPE,
      async ({ tx, recordId, toStateKey }) => {
        await tx.oos.update({
          where: { id: recordId },
          data: {
            status: toStateKey,
            investigationPhase: toStateKey === 'closed' ? undefined : toStateKey,
            ...(toStateKey === 'phase_2_manufacturing_investigation'
              ? { phase2Triggered: true }
              : {}),
            ...(toStateKey === 'closed' ? { closedAt: new Date() } : {}),
          },
        })
      },
    )

    // Pass A2 (item 4c) — a manufacturing (Phase 2) investigation cannot be
    // completed without its attached investigation report document.
    this.guardRegistry.register(
      QUALITY_OOS_RECORD_TYPE,
      'phase_2_manufacturing_investigation',
      async ({ tx, companyId, recordId }) => {
        const reports = await tx.document.count({
          where: { companyId, recordType: OOS_MANUFACTURING_REPORT_RECORD_TYPE, recordId },
        })
        if (reports === 0) {
          return {
            allowed: false,
            reason:
              'Attach the manufacturing investigation report document before completing this investigation.',
          }
        }
        return { allowed: true }
      },
    )

    // The real *Barr Labs* guard: an OOS cannot close while still in
    // Phase 1 unless a documented assignable lab cause exists — the
    // concrete, inspectable proof this implements the real FDA OOS
    // framework rather than a generic "investigate and close" box.
    this.guardRegistry.register(
      QUALITY_OOS_RECORD_TYPE,
      'phase_1_lab_investigation',
      async ({ tx, recordId, toStateKey }) => {
        if (toStateKey !== 'closed') return { allowed: true }
        const oos = await tx.oos.findUnique({ where: { id: recordId } })
        if (oos?.phase1AssignableCauseFound !== true) {
          return {
            allowed: false,
            reason:
              'This OOS cannot close from Phase 1 without a documented assignable lab cause — record one, or move to Phase 2.',
          }
        }
        return { allowed: true }
      },
    )
  }
}
