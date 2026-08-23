import { RegulatorySubmissionWorkflowGuards } from './regulatory-submission-workflow-guards.service'

describe('RegulatorySubmissionWorkflowGuards', () => {
  function buildGuard() {
    let registered: ((ctx: unknown) => Promise<{ allowed: boolean; reason?: string }>) | null = null
    const guardRegistry = {
      register: jest.fn((_recordType: string, _fromStateKey: string, fn: typeof registered) => {
        registered = fn
      }),
    }
    const guards = new RegulatorySubmissionWorkflowGuards(guardRegistry as never)
    guards.onModuleInit()
    return { run: (ctx: unknown) => registered!(ctx) }
  }

  it('allows a transition to any state other than "submitted" unconditionally', async () => {
    const { run } = buildGuard()
    const result = await run({
      tx: {},
      companyId: 'company-1',
      recordId: 'case-1',
      toStateKey: 'some_other_state',
    })
    expect(result.allowed).toBe(true)
  })

  it('blocks Submitted when no submission has ever been generated for this case', async () => {
    const { run } = buildGuard()
    const tx = {
      case: { findFirst: jest.fn().mockResolvedValue({ reportTypeId: 'rt-adr' }) },
      submissionFormat: { findFirst: jest.fn().mockResolvedValue({ channel: 'vigiflow' }) },
      regulatorySubmission: { findFirst: jest.fn().mockResolvedValue(null) },
    }
    const result = await run({
      tx,
      companyId: 'company-1',
      recordId: 'case-1',
      toStateKey: 'submitted',
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('generate')
  })

  it('blocks Submitted when the latest submission has no evidence attached yet', async () => {
    const { run } = buildGuard()
    const tx = {
      case: { findFirst: jest.fn().mockResolvedValue({ reportTypeId: 'rt-adr' }) },
      submissionFormat: { findFirst: jest.fn().mockResolvedValue({ channel: 'vigiflow' }) },
      regulatorySubmission: {
        findFirst: jest.fn().mockResolvedValue({ submissionNumber: 1, evidenceDocumentId: null }),
      },
    }
    const result = await run({
      tx,
      companyId: 'company-1',
      recordId: 'case-1',
      toStateKey: 'submitted',
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('evidence')
  })

  it('allows Submitted once the latest submission has evidence attached', async () => {
    const { run } = buildGuard()
    const tx = {
      case: { findFirst: jest.fn().mockResolvedValue({ reportTypeId: 'rt-adr' }) },
      submissionFormat: { findFirst: jest.fn().mockResolvedValue({ channel: 'vigiflow' }) },
      regulatorySubmission: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ submissionNumber: 1, evidenceDocumentId: 'doc-evidence' }),
      },
    }
    const result = await run({
      tx,
      companyId: 'company-1',
      recordId: 'case-1',
      toStateKey: 'submitted',
    })
    expect(result.allowed).toBe(true)
  })

  // Regression test for a real, previously-shipped bug found while
  // building Stage 14 (see this guard's own doc comment): a report type
  // with no active `vigiflow` SubmissionFormat at all (AEFI/dhis2,
  // clinical_trial_sae's Ethics Committee destination) must never be
  // blocked here — it can never produce a `RegulatorySubmission` in the
  // first place, so requiring one unconditionally would permanently
  // strand every case of that report type at Submission Ready.
  it('allows Submitted unconditionally for a report type with no active vigiflow SubmissionFormat (e.g. AEFI/dhis2, clinical-trial SAE)', async () => {
    const { run } = buildGuard()
    const regulatorySubmissionFindFirst = jest.fn()
    const tx = {
      case: { findFirst: jest.fn().mockResolvedValue({ reportTypeId: 'rt-aefi' }) },
      submissionFormat: { findFirst: jest.fn().mockResolvedValue(null) },
      regulatorySubmission: { findFirst: regulatorySubmissionFindFirst },
    }
    const result = await run({
      tx,
      companyId: 'company-1',
      recordId: 'case-1',
      toStateKey: 'submitted',
    })
    expect(result.allowed).toBe(true)
    // Never even checked for a RegulatorySubmission — the exemption
    // short-circuits before that query, per the guard's own early return.
    expect(regulatorySubmissionFindFirst).not.toHaveBeenCalled()
  })

  it('allows Submitted (does not block) when the case itself cannot be found, rather than crashing', async () => {
    const { run } = buildGuard()
    const tx = {
      case: { findFirst: jest.fn().mockResolvedValue(null) },
      submissionFormat: { findFirst: jest.fn() },
      regulatorySubmission: { findFirst: jest.fn() },
    }
    const result = await run({
      tx,
      companyId: 'company-1',
      recordId: 'case-1',
      toStateKey: 'submitted',
    })
    expect(result.allowed).toBe(true)
  })
})
