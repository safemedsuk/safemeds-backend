import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegQueryService } from './reg-query.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const uploadDirect = jest.fn().mockResolvedValue({ document: { id: 'doc-response-1' } })
  const documentsService = { uploadDirect } as never

  const encrypt = jest.fn((plaintext: string) => `enc(${plaintext})`)
  const decrypt = jest.fn((ciphertext: string) =>
    ciphertext.replace(/^enc\(/, '').replace(/\)$/, ''),
  )
  const encryptionService = { encrypt, decrypt } as never

  const computeOrRecompute = jest.fn().mockResolvedValue(null)
  const regDeadlineService = { computeOrRecompute } as never

  const regDossierFindFirst = jest
    .fn()
    .mockResolvedValue({
      id: 'dossier-1',
      authorityId: 'authority-1',
      productClass: 'generic_pharma',
      authority: { countryId: 'ke' },
    })
  const regQueryCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const regQueryFindMany = jest.fn().mockResolvedValue([])
  const regQueryFindFirst = jest.fn()
  const regQueryUpdate = jest
    .fn()
    .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))

  const resolveEffective = jest.fn().mockResolvedValue('full_service')
  const engagementModelService = { resolveEffective } as never

  const tables = {
    regDossier: { findFirst: regDossierFindFirst },
    regQuery: {
      create: regQueryCreate,
      findMany: regQueryFindMany,
      findFirst: regQueryFindFirst,
      update: regQueryUpdate,
    },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new RegQueryService(
    rls as never,
    auditService,
    documentsService,
    encryptionService,
    regDeadlineService,
    engagementModelService,
  )
  return {
    service,
    auditLog,
    uploadDirect,
    encrypt,
    decrypt,
    computeOrRecompute,
    regDossierFindFirst,
    regQueryCreate,
    regQueryFindMany,
    regQueryFindFirst,
    regQueryUpdate,
    resolveEffective,
  }
}

describe('RegQueryService.receive', () => {
  it('404s when the dossier does not exist', async () => {
    const { service, regDossierFindFirst } = buildHarness()
    regDossierFindFirst.mockResolvedValue(null)

    await expect(
      service.receive(actor, 'dossier-1', { queryText: 'Please clarify X.' }, {}),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })

  it('encrypts the query text at rest and returns the real decrypted value, never the ciphertext', async () => {
    const { service, regQueryCreate } = buildHarness()

    const result = await service.receive(
      actor,
      'dossier-1',
      { queryText: 'Please clarify the CPP validity.' },
      {},
    )

    expect(regQueryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          queryTextEncrypted: 'enc(Please clarify the CPP validity.)',
          status: 'open',
        }),
      }),
    )
    expect(result.queryText).toBe('Please clarify the CPP validity.')
    expect(
      (result as unknown as { queryTextEncrypted?: string }).queryTextEncrypted,
    ).toBeUndefined()
  })

  it('defaults receivedDate to today when omitted, and honors an explicit one', async () => {
    const { service, regQueryCreate } = buildHarness()

    await service.receive(actor, 'dossier-1', { queryText: 'x', receivedDate: '2026-06-01' }, {})
    expect(regQueryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ receivedDate: new Date('2026-06-01') }),
      }),
    )
  })

  it('computes a RegDeadline via the reused Stage 0.4 engine, gracefully (never throwing) when nothing resolves', async () => {
    const { service, computeOrRecompute } = buildHarness()
    computeOrRecompute.mockResolvedValue(null)

    await service.receive(actor, 'dossier-1', { queryText: 'x' }, {})

    expect(computeOrRecompute).toHaveBeenCalledWith(
      expect.objectContaining({
        recordType: 'reg_query_response',
        obligationType: 'query_response',
        countryId: 'ke',
        authorityId: 'authority-1',
        productClass: 'generic_pharma',
      }),
    )
  })
})

describe('RegQueryService.respond', () => {
  const responseFile = {
    buffer: Buffer.from(''),
    originalname: 'response.pdf',
    mimetype: 'application/pdf',
  }

  it('404s when the query does not exist', async () => {
    const { service, regQueryFindFirst } = buildHarness()
    regQueryFindFirst.mockResolvedValue(null)

    await expect(
      service.respond(actor, 'dossier-1', 'query-1', responseFile, undefined, {}),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  it('refuses to respond twice to the same query', async () => {
    const { service, regQueryFindFirst } = buildHarness()
    regQueryFindFirst.mockResolvedValue({
      id: 'query-1',
      status: 'closed',
      queryTextEncrypted: 'enc(x)',
    })

    await expect(
      service.respond(actor, 'dossier-1', 'query-1', responseFile, undefined, {}),
    ).rejects.toMatchObject({
      response: { code: 'ALREADY_RESPONDED' },
    })
  })

  it('attaches the response document, closes the query, and returns the decrypted value', async () => {
    const { service, regQueryFindFirst, regQueryUpdate } = buildHarness()
    regQueryFindFirst.mockResolvedValue({
      id: 'query-1',
      status: 'open',
      queryTextEncrypted: 'enc(Please clarify.)',
    })
    regQueryUpdate.mockImplementation(({ where, data }) =>
      Promise.resolve({ id: where.id, queryTextEncrypted: 'enc(Please clarify.)', ...data }),
    )

    const result = await service.respond(actor, 'dossier-1', 'query-1', responseFile, undefined, {})

    expect(regQueryUpdate).toHaveBeenCalledWith({
      where: { id: 'query-1' },
      data: {
        responseDocumentId: 'doc-response-1',
        responseNoteEncrypted: undefined,
        respondedAt: expect.any(Date),
        respondedBy: 'user-1',
        status: 'closed',
      },
    })
    expect(result.queryText).toBe('Please clarify.')
  })

  // RegCloud (Phase 12) Stage 15 — `client_handles_queries` engagement.
  it('400s with no file when the dossier is not engaged as client_handles_queries', async () => {
    const { service, regQueryFindFirst, resolveEffective } = buildHarness()
    regQueryFindFirst.mockResolvedValue({
      id: 'query-1',
      status: 'open',
      queryTextEncrypted: 'enc(x)',
    })
    resolveEffective.mockResolvedValue('full_service')

    await expect(
      service.respond(actor, 'dossier-1', 'query-1', null, 'The client says it was resolved.', {}),
    ).rejects.toMatchObject({
      response: { code: 'RESPONSE_DOCUMENT_REQUIRED' },
    })
  })

  it('400s with no file and no note even under client_handles_queries', async () => {
    const { service, regQueryFindFirst, resolveEffective } = buildHarness()
    regQueryFindFirst.mockResolvedValue({
      id: 'query-1',
      status: 'open',
      queryTextEncrypted: 'enc(x)',
    })
    resolveEffective.mockResolvedValue('client_handles_queries')

    await expect(
      service.respond(actor, 'dossier-1', 'query-1', null, undefined, {}),
    ).rejects.toMatchObject({
      response: { code: 'RESPONSE_NOTE_REQUIRED' },
    })
  })

  it('closes the query with an encrypted note instead of a document when client_handles_queries and no file is given', async () => {
    const { service, regQueryFindFirst, regQueryUpdate, resolveEffective, uploadDirect } =
      buildHarness()
    regQueryFindFirst.mockResolvedValue({
      id: 'query-1',
      status: 'open',
      queryTextEncrypted: 'enc(x)',
    })
    resolveEffective.mockResolvedValue('client_handles_queries')
    regQueryUpdate.mockImplementation(({ where, data }) =>
      Promise.resolve({ id: where.id, queryTextEncrypted: 'enc(x)', ...data }),
    )

    const result = await service.respond(
      actor,
      'dossier-1',
      'query-1',
      null,
      'The client confirmed resolution directly with the regulator.',
      {},
    )

    expect(uploadDirect).not.toHaveBeenCalled()
    expect(regQueryUpdate).toHaveBeenCalledWith({
      where: { id: 'query-1' },
      data: {
        responseDocumentId: undefined,
        responseNoteEncrypted: 'enc(The client confirmed resolution directly with the regulator.)',
        respondedAt: expect.any(Date),
        respondedBy: 'user-1',
        status: 'closed',
      },
    })
    expect(result.responseNote).toBe('The client confirmed resolution directly with the regulator.')
  })
})

describe('RegQueryService.list', () => {
  it('decrypts every row before returning it', async () => {
    const { service, regQueryFindMany } = buildHarness()
    regQueryFindMany.mockResolvedValue([
      { id: 'q1', queryTextEncrypted: 'enc(a)' },
      { id: 'q2', queryTextEncrypted: 'enc(b)' },
    ])

    const result = await service.list(actor, 'dossier-1')

    expect(result.map((r) => r.queryText)).toEqual(['a', 'b'])
  })
})
