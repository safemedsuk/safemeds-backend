import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegSubmissionService } from './reg-submission.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

const dossierRow = {
  id: 'dossier-1',
  authorityId: 'authority-1',
  productClass: 'generic_pharma',
  route: '*',
  product: { brandName: 'Amoxiclav' },
  authority: {
    id: 'authority-1',
    name: 'PPB',
    emblemObjectKey: null,
    country: { name: 'Kenya', officialName: null },
  },
  documentSlots: [
    {
      document: { title: 'CPP', versions: [{ filename: 'cpp.pdf' }] },
      requiredDocumentDefinition: { name: 'Certificate of Pharmaceutical Product' },
      labelOverride: null,
      ctdModule: 'Module 1',
    },
    { document: null, requiredDocumentDefinition: null, labelOverride: null, ctdModule: null },
  ],
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const uploadDirect = jest.fn().mockResolvedValue({ document: { id: 'doc-cover-1' } })
  const documentsService = { uploadDirect } as never

  const getObjectBuffer = jest.fn().mockResolvedValue(Buffer.from('emblem'))
  const storageService = { getObjectBuffer } as never

  const render = jest.fn().mockResolvedValue(Buffer.from('%PDF fake'))
  const pdfService = { render } as never

  const regDossierFindFirst = jest.fn().mockResolvedValue(dossierRow)
  const workflowInstanceFindFirst = jest
    .fn()
    .mockResolvedValue({ currentState: { stateKey: 'completeness_check' } })
  const companyFindUniqueOrThrow = jest.fn().mockResolvedValue({ name: 'RegCloud Test Co' })
  const userFindFirstOrThrow = jest.fn().mockResolvedValue({ fullName: 'Jane RA Officer' })
  const regSubmissionCount = jest.fn().mockResolvedValue(0)
  const reportTypeFindUnique = jest.fn().mockResolvedValue(null)
  const submissionFormatFindFirst = jest.fn().mockResolvedValue(null)
  const regSubmissionCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const regSubmissionFindFirst = jest.fn()
  const regSubmissionUpdate = jest
    .fn()
    .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))

  const tables = {
    regDossier: { findFirst: regDossierFindFirst },
    workflowInstance: { findFirst: workflowInstanceFindFirst },
    company: { findUniqueOrThrow: companyFindUniqueOrThrow },
    user: { findFirstOrThrow: userFindFirstOrThrow },
    regSubmission: {
      count: regSubmissionCount,
      create: regSubmissionCreate,
      findFirst: regSubmissionFindFirst,
      update: regSubmissionUpdate,
    },
    reportType: { findUnique: reportTypeFindUnique },
    submissionFormat: { findFirst: submissionFormatFindFirst },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new RegSubmissionService(
    rls as never,
    auditService,
    documentsService,
    storageService,
    pdfService,
  )
  return {
    service,
    auditLog,
    uploadDirect,
    getObjectBuffer,
    render,
    regDossierFindFirst,
    workflowInstanceFindFirst,
    reportTypeFindUnique,
    submissionFormatFindFirst,
    regSubmissionCreate,
    regSubmissionCount,
    regSubmissionFindFirst,
    regSubmissionUpdate,
  }
}

describe('RegSubmissionService.generate', () => {
  it('404s when the dossier does not exist', async () => {
    const { service, regDossierFindFirst } = buildHarness()
    regDossierFindFirst.mockResolvedValue(null)

    await expect(service.generate(actor, 'dossier-1', {})).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  it('rejects generation when the dossier has not reached completeness_check or responding', async () => {
    const { service, workflowInstanceFindFirst } = buildHarness()
    workflowInstanceFindFirst.mockResolvedValue({ currentState: { stateKey: 'compiling' } })

    await expect(service.generate(actor, 'dossier-1', {})).rejects.toMatchObject({
      response: { code: 'DOSSIER_NOT_READY' },
    })
  })

  it('allows generation from completeness_check and from responding (a fresh resubmission attempt)', async () => {
    const { service, workflowInstanceFindFirst, regSubmissionCreate } = buildHarness()
    workflowInstanceFindFirst.mockResolvedValue({ currentState: { stateKey: 'responding' } })

    await service.generate(actor, 'dossier-1', {})
    expect(regSubmissionCreate).toHaveBeenCalled()
  })

  /** testing-correction-explanation.md §3.1 — a renewal dossier is fast-forwarded straight to `renewal_requested`, skipping Planning/Compiling/Completeness Check entirely; without this, its only real action (Generate Submission) could never be taken at all. */
  it('allows generation from renewal_requested — a renewal dossier\'s real entry point', async () => {
    const { service, workflowInstanceFindFirst, regSubmissionCreate } = buildHarness()
    workflowInstanceFindFirst.mockResolvedValue({ currentState: { stateKey: 'renewal_requested' } })

    await service.generate(actor, 'dossier-1', {})
    expect(regSubmissionCreate).toHaveBeenCalled()
  })

  it('defaults the channel to paper_pdf when no active SubmissionFormat resolves', async () => {
    const { service, regSubmissionCreate } = buildHarness()

    await service.generate(actor, 'dossier-1', {})

    expect(regSubmissionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channel: 'paper_pdf' }) }),
    )
  })

  it('uses the resolved SubmissionFormat channel when one is active', async () => {
    const { service, reportTypeFindUnique, submissionFormatFindFirst, regSubmissionCreate } =
      buildHarness()
    reportTypeFindUnique.mockResolvedValue({ id: 'rt-1' })
    submissionFormatFindFirst.mockResolvedValue({ channel: 'portal' })

    await service.generate(actor, 'dossier-1', {})

    expect(regSubmissionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channel: 'portal' }) }),
    )
  })

  it('increments submissionNumber across attempts', async () => {
    const { service, regSubmissionCount, regSubmissionCreate } = buildHarness()
    regSubmissionCount.mockResolvedValue(2)

    await service.generate(actor, 'dossier-1', {})

    expect(regSubmissionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ submissionNumber: 3 }) }),
    )
  })

  it('never fails generation on an unreadable emblem — falls back gracefully', async () => {
    const { service, getObjectBuffer, render } = buildHarness()
    getObjectBuffer.mockRejectedValue(new Error('R2 unreachable'))

    await service.generate(actor, 'dossier-1', {})

    expect(render).toHaveBeenCalledWith(expect.objectContaining({ emblemBuffer: null }))
  })

  it('lists only documents that actually have a linked Document, using its label/CTD module/filename', async () => {
    const { service, render } = buildHarness()

    await service.generate(actor, 'dossier-1', {})

    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        documents: [
          {
            label: 'Certificate of Pharmaceutical Product',
            ctdModule: 'Module 1',
            filename: 'cpp.pdf',
          },
        ],
      }),
    )
  })
})

describe('RegSubmissionService.attachEvidence', () => {
  it('404s when the submission does not exist', async () => {
    const { service, regSubmissionFindFirst } = buildHarness()
    regSubmissionFindFirst.mockResolvedValue(null)

    await expect(
      service.attachEvidence(
        actor,
        'sub-1',
        { buffer: Buffer.from(''), originalname: 'evidence.pdf', mimetype: 'application/pdf' },
        {},
      ),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  it('records the evidence document, dispatchedAt, and dispatchedBy', async () => {
    const { service, regSubmissionFindFirst, regSubmissionUpdate, uploadDirect } = buildHarness()
    regSubmissionFindFirst.mockResolvedValue({ id: 'sub-1', regDossierId: 'dossier-1' })
    uploadDirect.mockResolvedValue({ document: { id: 'doc-evidence-1' } })

    await service.attachEvidence(
      actor,
      'sub-1',
      { buffer: Buffer.from(''), originalname: 'evidence.pdf', mimetype: 'application/pdf' },
      {},
    )

    expect(regSubmissionUpdate).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: {
        evidenceDocumentId: 'doc-evidence-1',
        dispatchedAt: expect.any(Date),
        dispatchedBy: 'user-1',
      },
    })
  })
})

describe('RegSubmissionService.removeEvidence', () => {
  it('404s when the submission does not exist', async () => {
    const { service, regSubmissionFindFirst } = buildHarness()
    regSubmissionFindFirst.mockResolvedValue(null)

    await expect(service.removeEvidence(actor, 'sub-1', {})).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  it('404s when the submission has no evidence attached yet', async () => {
    const { service, regSubmissionFindFirst } = buildHarness()
    regSubmissionFindFirst.mockResolvedValue({
      id: 'sub-1',
      regDossierId: 'dossier-1',
      evidenceDocumentId: null,
    })

    await expect(service.removeEvidence(actor, 'sub-1', {})).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  it('clears evidenceDocumentId, dispatchedAt, and dispatchedBy, and audits the removal', async () => {
    const { service, regSubmissionFindFirst, regSubmissionUpdate, auditLog } = buildHarness()
    regSubmissionFindFirst.mockResolvedValue({
      id: 'sub-1',
      regDossierId: 'dossier-1',
      evidenceDocumentId: 'doc-wrong-file',
    })

    await service.removeEvidence(actor, 'sub-1', {})

    expect(regSubmissionUpdate).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { evidenceDocumentId: null, dispatchedAt: null, dispatchedBy: null },
    })
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'reg_submission_evidence_removed',
        recordId: 'dossier-1',
        oldValue: { submissionId: 'sub-1', evidenceDocumentId: 'doc-wrong-file' },
      }),
    )
  })
})
