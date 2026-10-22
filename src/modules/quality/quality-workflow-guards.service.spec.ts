import { TransitionGuardFn } from '../workflow/workflow-guard-registry.service'
import { StatusSyncFn } from '../workflow/workflow-status-sync-registry.service'
import { QUALITY_CHANGE_CONTROL_RECORD_TYPE } from './change-control.service'
import { QUALITY_COMPLAINT_RECORD_TYPE } from './complaint.service'
import { QUALITY_DEVIATION_RECORD_TYPE } from './deviation.service'
import { QUALITY_OOS_RECORD_TYPE } from './oos.service'
import { QualityWorkflowGuards } from './quality-workflow-guards.service'
import { QUALITY_CONTROLLED_DOCUMENT_RECORD_TYPE } from './sop.service'

function buildHarness() {
  const guardRegister = jest.fn()
  const guardRegistry = { register: guardRegister } as never
  const statusSyncRegister = jest.fn()
  const statusSyncRegistry = { register: statusSyncRegister } as never
  const notificationsCreate = jest.fn().mockResolvedValue(undefined)
  const notificationsService = { create: notificationsCreate } as never
  const rolloutForEffectiveSop = jest.fn().mockResolvedValue(0)
  const trainingComplianceService = { rolloutForEffectiveSop } as never

  new QualityWorkflowGuards(
    guardRegistry,
    statusSyncRegistry,
    notificationsService,
    trainingComplianceService,
  ).onModuleInit()

  function guardFor(recordType: string, fromStateKey: string, nth = 0): TransitionGuardFn {
    const calls = (guardRegister.mock.calls as [string, string, TransitionGuardFn][]).filter(
      ([rt, fsk]) => rt === recordType && fsk === fromStateKey,
    )
    return calls[nth][2]
  }
  function syncFor(recordType: string): StatusSyncFn {
    const call = (statusSyncRegister.mock.calls as [string, StatusSyncFn][]).find(
      ([rt]) => rt === recordType,
    )!
    return call[1]
  }

  return { guardRegister, statusSyncRegister, notificationsCreate, guardFor, syncFor }
}

describe('QualityWorkflowGuards — registration', () => {
  it('registers 10 guards and 5 status-syncs (Pass A2 added the investigation report and manufacturing report guards)', () => {
    const { guardRegister, statusSyncRegister } = buildHarness()
    expect(guardRegister).toHaveBeenCalledTimes(10)
    expect(statusSyncRegister).toHaveBeenCalledTimes(5)
  })
})

describe('QualityWorkflowGuards — Sop (Document Control)', () => {
  it('blocks the document author from approving their own document', async () => {
    const { guardFor } = buildHarness()
    const guard = guardFor(QUALITY_CONTROLLED_DOCUMENT_RECORD_TYPE, 'in_review')
    const findUnique = jest.fn().mockResolvedValue({ createdBy: 'author-1' })
    const tx = { sop: { findUnique } } as never

    const result = await guard({
      tx,
      companyId: 'company-1',
      recordId: 'sop-1',
      toStateKey: 'approved',
      actorUserId: 'author-1',
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('own author')
  })

  it('allows a different actor to approve', async () => {
    const { guardFor } = buildHarness()
    const guard = guardFor(QUALITY_CONTROLLED_DOCUMENT_RECORD_TYPE, 'in_review')
    const findUnique = jest.fn().mockResolvedValue({ createdBy: 'author-1' })
    const tx = { sop: { findUnique } } as never

    const result = await guard({
      tx,
      companyId: 'company-1',
      recordId: 'sop-1',
      toStateKey: 'approved',
      actorUserId: 'reviewer-1',
    })
    expect(result.allowed).toBe(true)
  })

  it('does not gate the reject-back-to-draft transition', async () => {
    const { guardFor } = buildHarness()
    const guard = guardFor(QUALITY_CONTROLLED_DOCUMENT_RECORD_TYPE, 'in_review')
    const tx = { sop: { findUnique: jest.fn() } } as never
    const result = await guard({
      tx,
      companyId: 'company-1',
      recordId: 'sop-1',
      toStateKey: 'draft',
      actorUserId: 'author-1',
    })
    expect(result.allowed).toBe(true)
  })

  it('requires a reason to retire', async () => {
    const { guardFor } = buildHarness()
    const guard = guardFor(QUALITY_CONTROLLED_DOCUMENT_RECORD_TYPE, 'effective')
    const noReason = await guard({
      tx: {} as never,
      companyId: 'company-1',
      recordId: 'sop-1',
      toStateKey: 'retired',
      actorUserId: 'user-1',
    })
    expect(noReason.allowed).toBe(false)

    const withReason = await guard({
      tx: {} as never,
      companyId: 'company-1',
      recordId: 'sop-1',
      toStateKey: 'retired',
      actorUserId: 'user-1',
      note: 'Superseded by a new regulatory requirement',
    })
    expect(withReason.allowed).toBe(true)
  })

  it('status-sync stamps effectiveDate and supersedes the prior version on going effective', async () => {
    const { syncFor } = buildHarness()
    const sync = syncFor(QUALITY_CONTROLLED_DOCUMENT_RECORD_TYPE)

    const sopUpdate = jest.fn()
    const sopFindUnique = jest.fn().mockResolvedValue({ supersedesDocumentId: 'sop-old' })
    const oldInstance = { id: 'wi-old', definitionId: 'def-1' }
    const workflowInstanceFindFirst = jest.fn().mockResolvedValue(oldInstance)
    const workflowStateFindFirst = jest.fn().mockResolvedValue({ id: 'state-superseded' })
    const workflowInstanceUpdate = jest.fn()
    const tx = {
      sop: { findUnique: sopFindUnique, update: sopUpdate },
      workflowInstance: { findFirst: workflowInstanceFindFirst, update: workflowInstanceUpdate },
      workflowState: { findFirst: workflowStateFindFirst },
    } as never

    await sync({ tx, recordId: 'sop-new', toStateKey: 'effective', companyId: 'company-1' })

    expect(sopUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sop-new' },
        data: expect.objectContaining({ status: 'effective' }),
      }),
    )
    expect(workflowInstanceUpdate).toHaveBeenCalledWith({
      where: { id: 'wi-old' },
      data: expect.objectContaining({ currentStateId: 'state-superseded' }),
    })
    expect(sopUpdate).toHaveBeenCalledWith({
      where: { id: 'sop-old' },
      data: { status: 'superseded' },
    })
  })

  it('status-sync does nothing extra for a fresh document with no prior version', async () => {
    const { syncFor } = buildHarness()
    const sync = syncFor(QUALITY_CONTROLLED_DOCUMENT_RECORD_TYPE)
    const sopUpdate = jest.fn()
    const sopFindUnique = jest.fn().mockResolvedValue({ supersedesDocumentId: null })
    const tx = { sop: { findUnique: sopFindUnique, update: sopUpdate } } as never

    await sync({ tx, recordId: 'sop-1', toStateKey: 'effective', companyId: 'company-1' })
    expect(sopUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('QualityWorkflowGuards — Deviation', () => {
  it('requires a valid severity to leave Detected', async () => {
    const { guardFor } = buildHarness()
    const guard = guardFor(QUALITY_DEVIATION_RECORD_TYPE, 'detected')

    const missing = await guard({
      tx: {} as never,
      companyId: 'company-1',
      recordId: 'dev-1',
      toStateKey: 'classifying',
      actorUserId: 'user-1',
    })
    expect(missing.allowed).toBe(false)

    const invalid = await guard({
      tx: {} as never,
      companyId: 'company-1',
      recordId: 'dev-1',
      toStateKey: 'classifying',
      actorUserId: 'user-1',
      payload: { severity: 'catastrophic' },
    })
    expect(invalid.allowed).toBe(false)

    const valid = await guard({
      tx: {} as never,
      companyId: 'company-1',
      recordId: 'dev-1',
      toStateKey: 'classifying',
      actorUserId: 'user-1',
      payload: { severity: 'major' },
    })
    expect(valid.allowed).toBe(true)
  })

  it('four-eyes: blocks the investigator from also being the reviewer moving to capa_pending', async () => {
    const { guardFor } = buildHarness()
    const guard = guardFor(QUALITY_DEVIATION_RECORD_TYPE, 'investigating')
    const findUnique = jest.fn().mockResolvedValue({ investigatorUserId: 'investigator-1' })
    const tx = { investigation: { findUnique } } as never

    const blocked = await guard({
      tx,
      companyId: 'company-1',
      recordId: 'dev-1',
      toStateKey: 'capa_pending',
      actorUserId: 'investigator-1',
    })
    expect(blocked.allowed).toBe(false)

    const allowed = await guard({
      tx,
      companyId: 'company-1',
      recordId: 'dev-1',
      toStateKey: 'capa_pending',
      actorUserId: 'reviewer-2',
    })
    expect(allowed.allowed).toBe(true)
  })

  it('capa_pending → closed is blocked with no CAPA at all, and with an open CAPA, and allowed once closed', async () => {
    const { guardFor } = buildHarness()
    const guard = guardFor(QUALITY_DEVIATION_RECORD_TYPE, 'capa_pending')

    const noCapa = await guard({
      tx: {
        capa: {
          findFirst: jest.fn().mockResolvedValue(null),
          count: jest.fn().mockResolvedValue(0),
        },
      } as never,
      companyId: 'company-1',
      recordId: 'dev-1',
      toStateKey: 'closed',
      actorUserId: 'user-1',
    })
    expect(noCapa.allowed).toBe(false)
    expect(noCapa.reason).toContain('needs a CAPA')

    const openCapa = await guard({
      tx: {
        capa: {
          findFirst: jest.fn().mockResolvedValue({ id: 'capa-1', status: 'open' }),
          count: jest.fn().mockResolvedValue(1),
        },
      } as never,
      companyId: 'company-1',
      recordId: 'dev-1',
      toStateKey: 'closed',
      actorUserId: 'user-1',
    })
    expect(openCapa.allowed).toBe(false)
    expect(openCapa.reason).toContain('open CAPA')

    const closedCapa = await guard({
      tx: {
        capa: {
          findFirst: jest.fn().mockResolvedValue(null),
          count: jest.fn().mockResolvedValue(1),
        },
      } as never,
      companyId: 'company-1',
      recordId: 'dev-1',
      toStateKey: 'closed',
      actorUserId: 'user-1',
    })
    expect(closedCapa.allowed).toBe(true)
  })

  it('status-sync sets severity and computes investigationDueAt from detectedAt on classify', async () => {
    const { syncFor } = buildHarness()
    const sync = syncFor(QUALITY_DEVIATION_RECORD_TYPE)
    const detectedAt = new Date('2026-09-01T00:00:00.000Z')
    const deviationUpdate = jest
      .fn()
      .mockResolvedValue({ deviationNumber: 'DEV-2026-00001', title: 'x' })
    const tx = {
      deviation: {
        findUnique: jest.fn().mockResolvedValue({ detectedAt }),
        update: deviationUpdate,
      },
      role: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn() },
    } as never

    await sync({
      tx,
      recordId: 'dev-1',
      toStateKey: 'classifying',
      companyId: 'company-1',
      payload: { severity: 'minor' },
    })

    expect(deviationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          severity: 'minor',
          investigationDueAt: new Date(detectedAt.getTime() + 10 * 24 * 60 * 60 * 1000),
        }),
      }),
    )
  })

  it('status-sync fans out an immediate notification to quality.close_capa-holding users on critical', async () => {
    const { syncFor, notificationsCreate } = buildHarness()
    const sync = syncFor(QUALITY_DEVIATION_RECORD_TYPE)
    const detectedAt = new Date('2026-09-01T00:00:00.000Z')
    const deviationUpdate = jest
      .fn()
      .mockResolvedValue({ deviationNumber: 'DEV-2026-00002', title: 'Critical mix-up' })
    const tx = {
      deviation: {
        findUnique: jest.fn().mockResolvedValue({ detectedAt }),
        update: deviationUpdate,
      },
      role: { findMany: jest.fn().mockResolvedValue([{ key: 'QUALITY_MANAGER' }]) },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'qm-1', email: 'qm@example.com' }]),
      },
    } as never

    await sync({
      tx,
      recordId: 'dev-1',
      toStateKey: 'classifying',
      companyId: 'company-1',
      payload: { severity: 'critical' },
    })

    expect(notificationsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        userId: 'qm-1',
        category: 'workflow_update',
        title: expect.stringContaining('DEV-2026-00002'),
        email: { to: 'qm@example.com' },
      }),
    )
  })

  it('status-sync sends no notification for a non-critical severity', async () => {
    const { syncFor, notificationsCreate } = buildHarness()
    const sync = syncFor(QUALITY_DEVIATION_RECORD_TYPE)
    const detectedAt = new Date('2026-09-01T00:00:00.000Z')
    const tx = {
      deviation: {
        findUnique: jest.fn().mockResolvedValue({ detectedAt }),
        update: jest.fn().mockResolvedValue({ deviationNumber: 'DEV-2026-00003', title: 'x' }),
      },
      role: { findMany: jest.fn() },
      user: { findMany: jest.fn() },
    } as never

    await sync({
      tx,
      recordId: 'dev-1',
      toStateKey: 'classifying',
      companyId: 'company-1',
      payload: { severity: 'minor' },
    })
    expect(notificationsCreate).not.toHaveBeenCalled()
  })
})

describe('QualityWorkflowGuards — Change Control', () => {
  it('status-sync writes status, stamping closedAt on closed', async () => {
    const { syncFor } = buildHarness()
    const sync = syncFor(QUALITY_CHANGE_CONTROL_RECORD_TYPE)
    const update = jest.fn()
    const tx = { changeControl: { update } } as never

    await sync({ tx, recordId: 'cc-1', toStateKey: 'implementing', companyId: 'company-1' })
    expect(update).toHaveBeenCalledWith({
      where: { id: 'cc-1' },
      data: expect.objectContaining({ status: 'implementing' }),
    })
    expect(update.mock.calls[0][0].data.closedAt).toBeUndefined()

    await sync({ tx, recordId: 'cc-1', toStateKey: 'closed', companyId: 'company-1' })
    expect(update.mock.calls[1][0].data.closedAt).toBeInstanceOf(Date)
  })

  it('impact_assessment → approved requires every needed approver role', async () => {
    const { guardFor } = buildHarness()
    const guard = guardFor(QUALITY_CHANGE_CONTROL_RECORD_TYPE, 'impact_assessment')

    const noApprovals = await guard({
      tx: {
        changeControl: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ impactAssessment: null, crossFunctionalApprovals: [] }),
        },
      } as never,
      companyId: 'company-1',
      recordId: 'cc-1',
      toStateKey: 'approved',
      actorUserId: 'user-1',
    })
    expect(noApprovals.allowed).toBe(false)
    expect(noApprovals.reason).toContain('QUALITY_MANAGER')

    const qmOnly = await guard({
      tx: {
        changeControl: {
          findUnique: jest.fn().mockResolvedValue({
            impactAssessment: { regulatoryImpact: { impacted: true } },
            crossFunctionalApprovals: [{ role: 'QUALITY_MANAGER' }],
          }),
        },
      } as never,
      companyId: 'company-1',
      recordId: 'cc-1',
      toStateKey: 'approved',
      actorUserId: 'user-1',
    })
    expect(qmOnly.allowed).toBe(false)
    expect(qmOnly.reason).toContain('REGULATORY_AFFAIRS_OFFICER')

    const bothApproved = await guard({
      tx: {
        changeControl: {
          findUnique: jest.fn().mockResolvedValue({
            impactAssessment: { regulatoryImpact: { impacted: true } },
            crossFunctionalApprovals: [
              { role: 'QUALITY_MANAGER' },
              { role: 'REGULATORY_AFFAIRS_OFFICER' },
            ],
          }),
        },
      } as never,
      companyId: 'company-1',
      recordId: 'cc-1',
      toStateKey: 'approved',
      actorUserId: 'user-1',
    })
    expect(bothApproved.allowed).toBe(true)
  })

  it('does not gate a transition other than → approved', async () => {
    const { guardFor } = buildHarness()
    const guard = guardFor(QUALITY_CHANGE_CONTROL_RECORD_TYPE, 'impact_assessment')
    const result = await guard({
      tx: { changeControl: { findUnique: jest.fn() } } as never,
      companyId: 'company-1',
      recordId: 'cc-1',
      toStateKey: 'proposed',
      actorUserId: 'user-1',
    })
    expect(result.allowed).toBe(true)
  })

  it('verifying → closed requires a non-empty verification result', async () => {
    const { guardFor } = buildHarness()
    const guard = guardFor(QUALITY_CHANGE_CONTROL_RECORD_TYPE, 'verifying')

    const missing = await guard({
      tx: {
        changeControl: { findUnique: jest.fn().mockResolvedValue({ verificationResult: null }) },
      } as never,
      companyId: 'company-1',
      recordId: 'cc-1',
      toStateKey: 'closed',
      actorUserId: 'user-1',
    })
    expect(missing.allowed).toBe(false)

    const present = await guard({
      tx: {
        changeControl: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ verificationResult: 'No adverse effect observed' }),
        },
      } as never,
      companyId: 'company-1',
      recordId: 'cc-1',
      toStateKey: 'closed',
      actorUserId: 'user-1',
    })
    expect(present.allowed).toBe(true)
  })
})

describe('QualityWorkflowGuards — Complaint', () => {
  it('status-sync writes the live workflow state onto Complaint.status', async () => {
    const { syncFor } = buildHarness()
    const sync = syncFor(QUALITY_COMPLAINT_RECORD_TYPE)
    const update = jest.fn()
    const tx = { complaint: { update } } as never

    await sync({ tx, recordId: 'cmp-1', toStateKey: 'investigating', companyId: 'company-1' })
    expect(update).toHaveBeenCalledWith({
      where: { id: 'cmp-1' },
      data: { status: 'investigating' },
    })
  })
})

describe('QualityWorkflowGuards — OOS/OOT Investigation', () => {
  it('status-sync mirrors investigationPhase onto status, sets phase2Triggered on Phase 2, closedAt on close', async () => {
    const { syncFor } = buildHarness()
    const sync = syncFor(QUALITY_OOS_RECORD_TYPE)
    const update = jest.fn()
    const tx = { oos: { update } } as never

    await sync({
      tx,
      recordId: 'oos-1',
      toStateKey: 'phase_2_manufacturing_investigation',
      companyId: 'company-1',
    })
    expect(update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        status: 'phase_2_manufacturing_investigation',
        investigationPhase: 'phase_2_manufacturing_investigation',
        phase2Triggered: true,
      }),
    )

    await sync({ tx, recordId: 'oos-1', toStateKey: 'closed', companyId: 'company-1' })
    expect(update.mock.calls[1][0].data.closedAt).toBeInstanceOf(Date)
    expect(update.mock.calls[1][0].data.investigationPhase).toBeUndefined()
  })

  it('the real *Barr Labs* guard: cannot close from Phase 1 without a documented assignable lab cause', async () => {
    const { guardFor } = buildHarness()
    const guard = guardFor(QUALITY_OOS_RECORD_TYPE, 'phase_1_lab_investigation')

    const noCause = await guard({
      tx: {
        oos: { findUnique: jest.fn().mockResolvedValue({ phase1AssignableCauseFound: null }) },
      } as never,
      companyId: 'company-1',
      recordId: 'oos-1',
      toStateKey: 'closed',
      actorUserId: 'user-1',
    })
    expect(noCause.allowed).toBe(false)

    const withCause = await guard({
      tx: {
        oos: { findUnique: jest.fn().mockResolvedValue({ phase1AssignableCauseFound: true }) },
      } as never,
      companyId: 'company-1',
      recordId: 'oos-1',
      toStateKey: 'closed',
      actorUserId: 'user-1',
    })
    expect(withCause.allowed).toBe(true)
  })

  it('does not gate the Phase 1 → Phase 2 transition', async () => {
    const { guardFor } = buildHarness()
    const guard = guardFor(QUALITY_OOS_RECORD_TYPE, 'phase_1_lab_investigation')
    const result = await guard({
      tx: { oos: { findUnique: jest.fn() } } as never,
      companyId: 'company-1',
      recordId: 'oos-1',
      toStateKey: 'phase_2_manufacturing_investigation',
      actorUserId: 'user-1',
    })
    expect(result.allowed).toBe(true)
  })
})
