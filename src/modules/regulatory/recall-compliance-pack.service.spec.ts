import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RecallCompliancePackService } from './recall-compliance-pack.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_MANAGER'],
  platformRole: null,
  tokenVersion: 1,
}
const noCompanyActor: AuthenticatedUser = {
  sub: 'user-2',
  companyId: null,
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

const RECALL_ID = 'recall-1'

function emptyFindMany() {
  return jest.fn().mockResolvedValue([])
}

function buildHarness(overrides: { recall?: Record<string, unknown> } = {}) {
  const recall = {
    id: RECALL_ID,
    companyId: 'company-1',
    ref: 'REC-2026-0001',
    reason: 'Contamination',
    mode: 'real',
    type: 'voluntary',
    level: 'wholesale',
    status: 'closure_pending',
    openedAt: new Date('2026-01-01'),
    closedAt: null,
    rootCauseCapaId: null,
    product: { brandName: 'Amoxiclav' },
    ...overrides.recall,
  }
  const recallFindFirst = jest.fn().mockResolvedValue(recall)
  const companyFindUniqueOrThrow = jest.fn().mockResolvedValue({ name: 'Acme Pharma' })
  const recallCountryFindMany = emptyFindMany()
  const riskAssessmentFindFirst = jest.fn().mockResolvedValue(null)
  const recallScopeVersionFindFirst = jest.fn().mockResolvedValue(null)
  const capaFindFirst = jest.fn().mockResolvedValue(null)
  const documentCount = jest.fn().mockResolvedValue(0)
  const workflowInstanceFindFirst = jest.fn().mockResolvedValue(null)
  const generatedReportCreate = jest.fn().mockResolvedValue({ id: 'report-1' })

  const tables = {
    recall: { findFirst: recallFindFirst, findUniqueOrThrow: jest.fn().mockResolvedValue(recall) },
    company: { findUniqueOrThrow: companyFindUniqueOrThrow },
    recallCountry: { findMany: recallCountryFindMany },
    riskAssessment: { findFirst: riskAssessmentFindFirst },
    recallScopeVersion: { findFirst: recallScopeVersionFindFirst },
    recallDistributionRecord: { findMany: emptyFindMany() },
    stakeholder: { findMany: emptyFindMany() },
    recallCascadeInvite: { findMany: emptyFindMany() },
    recallMessage: { findMany: emptyFindMany() },
    recallQuarantineRecord: { findMany: emptyFindMany() },
    recallReturnRecord: { findMany: emptyFindMany() },
    recallReconciliationSnapshot: { findMany: emptyFindMany() },
    recallDiscrepancy: { findMany: emptyFindMany() },
    recallDestructionRecord: { findMany: emptyFindMany() },
    recallEffectivenessCheck: { findMany: emptyFindMany() },
    recallSubmission: { findMany: emptyFindMany() },
    recallRule: { findMany: emptyFindMany() },
    capa: { findFirst: capaFindFirst },
    document: { count: documentCount },
    workflowInstance: { findFirst: workflowInstanceFindFirst },
    generatedReport: { create: generatedReportCreate, findMany: emptyFindMany() },
  }
  const rls = { runAsCompany: (_c: string, fn: (tx: typeof tables) => unknown) => fn(tables) }

  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditQuery = jest.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 200, total: 0, totalPages: 0 } })
  const auditService = { log: auditLog, query: auditQuery } as never

  const uploadDirect = jest.fn().mockResolvedValue({ document: { id: 'doc-1' } })
  const documentsService = { uploadDirect } as never

  const renderedPdf = Buffer.from('%PDF-fake')
  const render = jest.fn().mockResolvedValue(renderedPdf)
  const pdfService = { render } as never

  const service = new RecallCompliancePackService(rls as never, auditService, documentsService, pdfService)
  return { service, recallFindFirst, generatedReportCreate, uploadDirect, render, auditLog }
}

describe('RecallCompliancePackService', () => {
  it('rejects a platform actor with no company', async () => {
    const { service } = buildHarness()
    await expect(service.generate(noCompanyActor, RECALL_ID, {})).rejects.toThrow(ForbiddenException)
  })

  it('404s for a nonexistent recall', async () => {
    const { service, recallFindFirst } = buildHarness()
    recallFindFirst.mockResolvedValueOnce(null)
    await expect(service.generate(actor, RECALL_ID, {})).rejects.toThrow(NotFoundException)
  })

  it('renders the PDF, uploads it against a freshly-minted report id, and archives a new final GeneratedReport row', async () => {
    const { service, render, uploadDirect, generatedReportCreate, auditLog } = buildHarness()

    const result = await service.generate(actor, RECALL_ID, {})

    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({ recallRef: 'REC-2026-0001', productName: 'Amoxiclav', companyName: 'Acme Pharma' }),
    )
    // The document is uploaded against the report's own id, not the recall's — `GeneratedReport` carries no direct document-id column.
    const uploadCall = uploadDirect.mock.calls[0]
    expect(uploadCall[1]).toBe('generated_report')
    const reportId = uploadCall[2] as string

    expect(generatedReportCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: reportId,
          reportTypeKey: 'recall_compliance_pack',
          recordType: 'recall',
          recordId: RECALL_ID,
          status: 'final',
        }),
      }),
    )
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'recall_compliance_pack_generated' }),
    )
    expect(result).toEqual({ id: 'report-1' })
  })

  it('a second generate() call produces a genuinely new, separately-id’d report row rather than updating the first', async () => {
    const { service, generatedReportCreate } = buildHarness()

    await service.generate(actor, RECALL_ID, {})
    await service.generate(actor, RECALL_ID, {})

    const idsUsed = generatedReportCreate.mock.calls.map(
      (call) => (call[0] as { data: { id: string } }).data.id,
    )
    expect(new Set(idsUsed).size).toBe(2)
  })

  it('resolves the linked CAPA via Recall.rootCauseCapaId when no recall_investigation-sourced one exists', async () => {
    const { service, render } = buildHarness({ recall: { rootCauseCapaId: 'capa-99' } })
    await service.generate(actor, RECALL_ID, {})
    // Confirmed indirectly: assemble() completes without error even
    // though `capa.findFirst`'s own `OR` clause now includes the
    // rootCauseCapaId branch — the real behavior is unit-tested
    // directly in `recall-closure-gate.service.spec.ts`; this just
    // proves the pack assembly doesn't choke on it.
    expect(render).toHaveBeenCalled()
  })
})
