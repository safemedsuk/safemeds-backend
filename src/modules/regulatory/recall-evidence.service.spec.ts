import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RecallEvidenceService } from './recall-evidence.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
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
const COUNTRY_ID = 'country-1'

function buildHarness(overrides: {
  countries?: unknown[]
  destructionRecords?: unknown[]
  sightings?: unknown[]
  quarantineRecords?: unknown[]
  importJobs?: unknown[]
  submissions?: unknown[]
  genericDocs?: unknown[]
  documents?: { id: string; title: string; versions: { filename: string; sha256: string | null; createdAt: Date }[] }[]
} = {}) {
  const recallFindFirst = jest.fn().mockResolvedValue({ id: RECALL_ID, companyId: 'company-1' })
  const recallCountryFindMany = jest
    .fn()
    .mockResolvedValue(overrides.countries ?? [{ id: COUNTRY_ID, companyId: 'company-1', recallId: RECALL_ID }])
  const destructionFindMany = jest.fn().mockResolvedValue(overrides.destructionRecords ?? [])
  const sightingFindMany = jest.fn().mockResolvedValue(overrides.sightings ?? [])
  const quarantineFindMany = jest.fn().mockResolvedValue(overrides.quarantineRecords ?? [])
  const importJobFindMany = jest.fn().mockResolvedValue(overrides.importJobs ?? [])
  const submissionFindMany = jest.fn().mockResolvedValue(overrides.submissions ?? [])
  const documentFindManyGeneric = jest.fn().mockResolvedValue(overrides.genericDocs ?? [])
  const documentFindManyByIds = jest.fn().mockResolvedValue(overrides.documents ?? [])

  let documentFindManyCallCount = 0
  const documentFindMany = jest.fn().mockImplementation((args: unknown): Promise<unknown[]> => {
    documentFindManyCallCount += 1
    // The service's own two distinct `document.findMany` call shapes —
    // the first (generic recordType/recordId lookup) always fires,
    // the second (by-id resolution) only fires when there's something
    // to resolve.
    if (documentFindManyCallCount === 1) return documentFindManyGeneric(args) as Promise<unknown[]>
    return documentFindManyByIds(args) as Promise<unknown[]>
  })

  const tables = {
    recall: { findFirst: recallFindFirst },
    recallCountry: { findMany: recallCountryFindMany },
    recallDestructionRecord: { findMany: destructionFindMany },
    recallSighting: { findMany: sightingFindMany },
    recallQuarantineRecord: { findMany: quarantineFindMany },
    recallImportJob: { findMany: importJobFindMany },
    recallSubmission: { findMany: submissionFindMany },
    document: { findMany: documentFindMany },
  }
  const rls = { runAsCompany: (_c: string, fn: (tx: typeof tables) => unknown) => fn(tables) }
  const service = new RecallEvidenceService(rls as never)
  return { service, recallFindFirst }
}

describe('RecallEvidenceService.listEvidence', () => {
  it('rejects a platform actor with no company', async () => {
    const { service } = buildHarness()
    await expect(service.listEvidence(noCompanyActor, RECALL_ID)).rejects.toThrow(ForbiddenException)
  })

  it('404s for a nonexistent recall', async () => {
    const { service, recallFindFirst } = buildHarness()
    recallFindFirst.mockResolvedValueOnce(null)
    await expect(service.listEvidence(actor, RECALL_ID)).rejects.toThrow(NotFoundException)
  })

  it('returns an empty register when nothing is linked at all', async () => {
    const { service } = buildHarness()
    expect(await service.listEvidence(actor, RECALL_ID)).toEqual([])
  })

  it('aggregates documents referenced from destruction records, sightings, quarantine, imports, and submissions, each labelled by what it’s evidence for', async () => {
    const { service } = buildHarness({
      destructionRecords: [
        { disposalApprovalEvidenceId: 'doc-1', certificateEvidenceId: 'doc-2' },
      ],
      sightings: [{ evidenceDocumentId: 'doc-3' }],
      quarantineRecords: [{ evidenceDocumentIds: ['doc-4', 'doc-5'] }],
      importJobs: [{ documentId: 'doc-6' }],
      submissions: [{ documentId: 'doc-7', submittedProofDocumentId: 'doc-8' }],
      documents: [
        { id: 'doc-1', title: 'Disposal approval', versions: [{ filename: 'approval.pdf', sha256: 'aaa', createdAt: new Date('2026-01-01') }] },
        { id: 'doc-2', title: 'Certificate', versions: [{ filename: 'cert.pdf', sha256: 'bbb', createdAt: new Date('2026-01-02') }] },
        { id: 'doc-3', title: 'Sighting photo', versions: [{ filename: 'photo.jpg', sha256: 'ccc', createdAt: new Date('2026-01-03') }] },
        { id: 'doc-4', title: 'Quarantine evidence 1', versions: [] },
        { id: 'doc-5', title: 'Quarantine evidence 2', versions: [] },
        { id: 'doc-6', title: 'Import file', versions: [] },
        { id: 'doc-7', title: 'Submission PDF', versions: [] },
        { id: 'doc-8', title: 'Proof of submission', versions: [] },
      ],
    })

    const rows = await service.listEvidence(actor, RECALL_ID)
    expect(rows).toHaveLength(8)
    const disposalRow = rows.find((r) => r.documentId === 'doc-1')!
    expect(disposalRow.linkedTo).toMatch(/disposal approval/i)
    expect(disposalRow.sha256).toBe('aaa')
    expect(disposalRow.filename).toBe('approval.pdf')

    const certRow = rows.find((r) => r.documentId === 'doc-2')!
    expect(certRow.linkedTo).toMatch(/certificate/i)

    const sightingRow = rows.find((r) => r.documentId === 'doc-3')!
    expect(sightingRow.linkedTo).toMatch(/sighting/i)

    expect(rows.find((r) => r.documentId === 'doc-4')!.filename).toBeNull()
  })

  it('silently drops a referenced document id that no longer resolves under this company’s own RLS scope, rather than throwing', async () => {
    const { service } = buildHarness({
      sightings: [{ evidenceDocumentId: 'doc-orphaned' }],
      documents: [], // the id was referenced but never resolved (e.g. cross-tenant leakage would be blocked here)
    })
    const rows = await service.listEvidence(actor, RECALL_ID)
    expect(rows).toEqual([])
  })

  it('includes a plain attachment uploaded directly against the recall itself (recordType: recall)', async () => {
    const { service } = buildHarness({
      genericDocs: [{ id: 'doc-9' }],
      documents: [{ id: 'doc-9', title: 'General attachment', versions: [] }],
    })
    const rows = await service.listEvidence(actor, RECALL_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0].linkedTo).toMatch(/attached to this recall/i)
  })
})
