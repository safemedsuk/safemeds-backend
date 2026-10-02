import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegQueryService } from './reg-query.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

const queryLetterFile = {
  buffer: Buffer.from(''),
  originalname: 'query-letter.pdf',
  mimetype: 'application/pdf',
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
  const regQueryCount = jest.fn().mockResolvedValue(0)
  const regQueryFindFirst = jest.fn()
  const regQueryUpdate = jest
    .fn()
    .mockImplementation(({ where, data }) =>
      Promise.resolve({ id: where.id, queryTextEncrypted: 'enc(x)', ...data }),
    )
  const regQueryCorrespondenceCreate = jest
    .fn()
    .mockImplementation(({ data }) => Promise.resolve(data))
  const regQueryCorrespondenceFindMany = jest.fn().mockResolvedValue([])
  const userFindFirst = jest.fn().mockResolvedValue({ id: 'owner-1', status: 'active' })

  const resolveEffective = jest.fn().mockResolvedValue('full_service')
  const engagementModelService = { resolveEffective } as never

  const notificationsCreate = jest.fn().mockResolvedValue(undefined)
  const notificationsService = { create: notificationsCreate } as never

  const closeOpenForRecord = jest.fn().mockResolvedValue(undefined)
  const tasksService = { closeOpenForRecord } as never

  const tables = {
    regDossier: { findFirst: regDossierFindFirst },
    regQuery: {
      create: regQueryCreate,
      findMany: regQueryFindMany,
      count: regQueryCount,
      findFirst: regQueryFindFirst,
      update: regQueryUpdate,
    },
    regQueryCorrespondence: {
      create: regQueryCorrespondenceCreate,
      findMany: regQueryCorrespondenceFindMany,
    },
    user: { findFirst: userFindFirst },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new RegQueryService(
    rls as never,
    auditService,
    documentsService,
    encryptionService,
    regDeadlineService,
    engagementModelService,
    notificationsService,
    tasksService,
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
    regQueryCount,
    regQueryFindFirst,
    regQueryUpdate,
    regQueryCorrespondenceCreate,
    regQueryCorrespondenceFindMany,
    userFindFirst,
    resolveEffective,
    notificationsCreate,
    closeOpenForRecord,
  }
}

describe('RegQueryService.receive', () => {
  it('404s when the dossier does not exist', async () => {
    const { service, regDossierFindFirst } = buildHarness()
    regDossierFindFirst.mockResolvedValue(null)

    await expect(
      service.receive(
        actor,
        'dossier-1',
        { queryText: 'Please clarify X.', receivedDate: '2026-06-01' },
        queryLetterFile,
        {},
      ),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })

  it('encrypts the query text at rest and returns the real decrypted value, never the ciphertext', async () => {
    const { service, regQueryCreate } = buildHarness()

    const result = await service.receive(
      actor,
      'dossier-1',
      { queryText: 'Please clarify the CPP validity.', receivedDate: '2026-06-01' },
      queryLetterFile,
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

  it('honors the real, now-required receivedDate', async () => {
    const { service, regQueryCreate } = buildHarness()

    await service.receive(
      actor,
      'dossier-1',
      { queryText: 'x', receivedDate: '2026-06-01' },
      queryLetterFile,
      {},
    )
    expect(regQueryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ receivedDate: new Date('2026-06-01') }),
      }),
    )
  })

  it('testing-correction-explanation.md §2.1 — uploads the regulator query letter and stores queryLetterDocumentId, now mandatory', async () => {
    const { service, uploadDirect, regQueryCreate } = buildHarness()

    await service.receive(
      actor,
      'dossier-1',
      { queryText: 'x', receivedDate: '2026-06-01' },
      queryLetterFile,
      {},
    )

    expect(uploadDirect).toHaveBeenCalledWith(
      actor,
      'reg_query',
      expect.any(String),
      queryLetterFile,
      { title: 'Regulator Query Letter' },
      {},
    )
    expect(regQueryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ queryLetterDocumentId: 'doc-response-1' }),
      }),
    )
  })

  it('computes a RegDeadline via the reused Stage 0.4 engine, gracefully (never throwing) when nothing resolves', async () => {
    const { service, computeOrRecompute } = buildHarness()
    computeOrRecompute.mockResolvedValue(null)

    await service.receive(
      actor,
      'dossier-1',
      { queryText: 'x', receivedDate: '2026-06-01' },
      queryLetterFile,
      {},
    )

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
  const respondedDate = '2026-06-05'

  it('404s when the query does not exist', async () => {
    const { service, regQueryFindFirst } = buildHarness()
    regQueryFindFirst.mockResolvedValue(null)

    await expect(
      service.respond(actor, 'dossier-1', 'query-1', responseFile, 'Resolved.', respondedDate, {}),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  it('refuses to respond twice to the same query (already responded)', async () => {
    const { service, regQueryFindFirst } = buildHarness()
    regQueryFindFirst.mockResolvedValue({
      id: 'query-1',
      status: 'responded',
      queryTextEncrypted: 'enc(x)',
    })

    await expect(
      service.respond(actor, 'dossier-1', 'query-1', responseFile, 'Resolved.', respondedDate, {}),
    ).rejects.toMatchObject({
      response: { code: 'ALREADY_RESPONDED' },
    })
  })

  it('testing-correction-explanation.md §2.1 — a response note is always required, even alongside a document', async () => {
    const { service, regQueryFindFirst } = buildHarness()
    regQueryFindFirst.mockResolvedValue({
      id: 'query-1',
      status: 'open',
      queryTextEncrypted: 'enc(x)',
    })

    await expect(
      service.respond(actor, 'dossier-1', 'query-1', responseFile, '', respondedDate, {}),
    ).rejects.toMatchObject({ response: { code: 'RESPONSE_NOTE_REQUIRED' } })
  })

  it('testing-correction-explanation.md §2.1 — a real respondedDate is always required', async () => {
    const { service, regQueryFindFirst } = buildHarness()
    regQueryFindFirst.mockResolvedValue({
      id: 'query-1',
      status: 'open',
      queryTextEncrypted: 'enc(x)',
    })

    await expect(
      service.respond(actor, 'dossier-1', 'query-1', responseFile, 'Resolved.', 'not-a-date', {}),
    ).rejects.toMatchObject({ response: { code: 'RESPONDED_DATE_REQUIRED' } })
  })

  it('attaches the response document, the note, the real respondedDate, marks the query responded, and returns the decrypted value', async () => {
    const { service, regQueryFindFirst, regQueryUpdate } = buildHarness()
    regQueryFindFirst.mockResolvedValue({
      id: 'query-1',
      status: 'open',
      queryTextEncrypted: 'enc(Please clarify.)',
    })
    regQueryUpdate.mockImplementation(({ where, data }) =>
      Promise.resolve({ id: where.id, queryTextEncrypted: 'enc(Please clarify.)', ...data }),
    )

    const result = await service.respond(
      actor,
      'dossier-1',
      'query-1',
      responseFile,
      'Provided the requested stability data.',
      respondedDate,
      {},
    )

    expect(regQueryUpdate).toHaveBeenCalledWith({
      where: { id: 'query-1' },
      data: {
        responseDocumentId: 'doc-response-1',
        responseNoteEncrypted: 'enc(Provided the requested stability data.)',
        respondedDate: new Date(respondedDate),
        respondedAt: expect.any(Date),
        respondedBy: 'user-1',
        status: 'responded',
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
      service.respond(
        actor,
        'dossier-1',
        'query-1',
        null,
        'The client says it was resolved.',
        respondedDate,
        {},
      ),
    ).rejects.toMatchObject({
      response: { code: 'RESPONSE_DOCUMENT_REQUIRED' },
    })
  })

  it('marks the query responded with an encrypted note instead of a document when client_handles_queries and no file is given', async () => {
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
      respondedDate,
      {},
    )

    expect(uploadDirect).not.toHaveBeenCalled()
    expect(regQueryUpdate).toHaveBeenCalledWith({
      where: { id: 'query-1' },
      data: {
        responseDocumentId: undefined,
        responseNoteEncrypted: 'enc(The client confirmed resolution directly with the regulator.)',
        respondedDate: new Date(respondedDate),
        respondedAt: expect.any(Date),
        respondedBy: 'user-1',
        status: 'responded',
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

  it('CEO feedback 30 Sep 2026 — computes isOverdue live: open/in_progress past its due date is overdue, closed/responded never is', async () => {
    const { service, regQueryFindMany } = buildHarness()
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    regQueryFindMany.mockResolvedValue([
      { id: 'q1', status: 'open', responseDueDate: yesterday, queryTextEncrypted: 'enc(a)' },
      { id: 'q2', status: 'in_progress', responseDueDate: yesterday, queryTextEncrypted: 'enc(b)' },
      { id: 'q3', status: 'responded', responseDueDate: yesterday, queryTextEncrypted: 'enc(c)' },
      { id: 'q4', status: 'open', responseDueDate: null, queryTextEncrypted: 'enc(d)' },
    ])

    const result = await service.list(actor, 'dossier-1')

    expect(result.map((r) => r.isOverdue)).toEqual([true, true, false, false])
  })
})

describe('RegQueryService.updateDueDate', () => {
  it('404s when the query does not exist', async () => {
    const { service, regQueryFindFirst } = buildHarness()
    regQueryFindFirst.mockResolvedValue(null)

    await expect(
      service.updateDueDate(actor, 'dossier-1', 'query-1', { responseDueDate: '2026-07-01' }, {}),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })

  it('sets the manually-entered response due date and audits it', async () => {
    const { service, regQueryFindFirst, regQueryUpdate, auditLog } = buildHarness()
    regQueryFindFirst.mockResolvedValue({
      id: 'query-1',
      responseDueDate: null,
      queryTextEncrypted: 'enc(x)',
    })

    const result = await service.updateDueDate(
      actor,
      'dossier-1',
      'query-1',
      { responseDueDate: '2026-07-01' },
      {},
    )

    expect(regQueryUpdate).toHaveBeenCalledWith({
      where: { id: 'query-1' },
      data: { responseDueDate: new Date('2026-07-01') },
    })
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'reg_query_due_date_set' }),
    )
    expect(result.responseDueDate).toEqual(new Date('2026-07-01'))
  })
})

describe('RegQueryService.assignOwner', () => {
  it('rejects an owner who is not a real, active user in this company', async () => {
    const { service, regQueryFindFirst, userFindFirst } = buildHarness()
    regQueryFindFirst.mockResolvedValue({ id: 'query-1', status: 'open', ownerUserId: null, queryTextEncrypted: 'enc(x)' })
    userFindFirst.mockResolvedValue(null)

    await expect(
      service.assignOwner(actor, 'dossier-1', 'query-1', { ownerUserId: 'ghost-1' }, {}),
    ).rejects.toMatchObject({ response: { code: 'OWNER_NOT_FOUND' } })
  })

  it('assigns an owner, bumps an "open" query to "in_progress", and notifies the new owner', async () => {
    const { service, regQueryFindFirst, regQueryUpdate, notificationsCreate } = buildHarness()
    regQueryFindFirst.mockResolvedValue({
      id: 'query-1',
      status: 'open',
      ownerUserId: null,
      responseDueDate: null,
      queryTextEncrypted: 'enc(x)',
    })

    await service.assignOwner(actor, 'dossier-1', 'query-1', { ownerUserId: 'owner-1' }, {})

    expect(regQueryUpdate).toHaveBeenCalledWith({
      where: { id: 'query-1' },
      data: { ownerUserId: 'owner-1', status: 'in_progress' },
    })
    expect(notificationsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner-1', recordId: 'query-1' }),
    )
  })

  it('does not force an already in_progress/responded query back to in_progress on reassignment', async () => {
    const { service, regQueryFindFirst, regQueryUpdate } = buildHarness()
    regQueryFindFirst.mockResolvedValue({
      id: 'query-1',
      status: 'responded',
      ownerUserId: 'owner-old',
      responseDueDate: null,
      queryTextEncrypted: 'enc(x)',
    })

    await service.assignOwner(actor, 'dossier-1', 'query-1', { ownerUserId: 'owner-1' }, {})

    expect(regQueryUpdate).toHaveBeenCalledWith({
      where: { id: 'query-1' },
      data: { ownerUserId: 'owner-1' },
    })
  })

  it('un-assigns when ownerUserId is explicitly null', async () => {
    const { service, regQueryFindFirst, regQueryUpdate, notificationsCreate } = buildHarness()
    regQueryFindFirst.mockResolvedValue({
      id: 'query-1',
      status: 'in_progress',
      ownerUserId: 'owner-1',
      responseDueDate: null,
      queryTextEncrypted: 'enc(x)',
    })

    await service.assignOwner(actor, 'dossier-1', 'query-1', { ownerUserId: null }, {})

    expect(regQueryUpdate).toHaveBeenCalledWith({
      where: { id: 'query-1' },
      data: { ownerUserId: null },
    })
    expect(notificationsCreate).not.toHaveBeenCalled()
  })
})

describe('RegQueryService.addCorrespondence', () => {
  it('logs a thread entry, uploads an attached document, and bumps an "open" query to "in_progress"', async () => {
    const { service, regQueryFindFirst, regQueryCorrespondenceCreate, regQueryUpdate, uploadDirect } =
      buildHarness()
    regQueryFindFirst.mockResolvedValue({ id: 'query-1', status: 'open', queryTextEncrypted: 'enc(x)' })

    const result = await service.addCorrespondence(
      actor,
      'dossier-1',
      'query-1',
      { direction: 'from_regulator', channel: 'email', occurredOn: '2026-07-02', summary: 'Follow-up question.' },
      queryLetterFile,
      {},
    )

    expect(uploadDirect).toHaveBeenCalled()
    expect(regQueryCorrespondenceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: 'from_regulator',
          channel: 'email',
          documentId: 'doc-response-1',
        }),
      }),
    )
    expect(regQueryUpdate).toHaveBeenCalledWith({
      where: { id: 'query-1' },
      data: { status: 'in_progress' },
    })
    expect(result.summary).toBe('Follow-up question.')
  })

  it('logs a note-only entry (no document) without touching status once already in_progress', async () => {
    const { service, regQueryFindFirst, regQueryUpdate, uploadDirect } = buildHarness()
    regQueryFindFirst.mockResolvedValue({ id: 'query-1', status: 'in_progress', queryTextEncrypted: 'enc(x)' })

    await service.addCorrespondence(
      actor,
      'dossier-1',
      'query-1',
      { direction: 'internal_note', channel: 'note', occurredOn: '2026-07-02', summary: 'Called their office.' },
      null,
      {},
    )

    expect(uploadDirect).not.toHaveBeenCalled()
    expect(regQueryUpdate).not.toHaveBeenCalled()
  })
})

describe('RegQueryService.close', () => {
  it('refuses to close a query that was never responded to', async () => {
    const { service, regQueryFindFirst } = buildHarness()
    regQueryFindFirst.mockResolvedValue({ id: 'query-1', status: 'open', queryTextEncrypted: 'enc(x)' })

    await expect(service.close(actor, 'dossier-1', 'query-1', {}, {})).rejects.toMatchObject({
      response: { code: 'MUST_RESPOND_FIRST' },
    })
  })

  it('refuses to close a query twice', async () => {
    const { service, regQueryFindFirst } = buildHarness()
    regQueryFindFirst.mockResolvedValue({ id: 'query-1', status: 'closed', queryTextEncrypted: 'enc(x)' })

    await expect(service.close(actor, 'dossier-1', 'query-1', {}, {})).rejects.toMatchObject({
      response: { code: 'ALREADY_CLOSED' },
    })
  })

  it('closes a responded query, clears any open escalation task, and logs an optional closing note into the thread', async () => {
    const { service, regQueryFindFirst, regQueryUpdate, regQueryCorrespondenceCreate, closeOpenForRecord } =
      buildHarness()
    regQueryFindFirst.mockResolvedValue({ id: 'query-1', status: 'responded', queryTextEncrypted: 'enc(x)' })

    const result = await service.close(actor, 'dossier-1', 'query-1', { note: 'Regulator confirmed satisfaction.' }, {})

    expect(regQueryUpdate).toHaveBeenCalledWith({
      where: { id: 'query-1' },
      data: { status: 'closed', closedAt: expect.any(Date), closedBy: 'user-1' },
    })
    expect(regQueryCorrespondenceCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ direction: 'internal_note' }) }),
    )
    expect(closeOpenForRecord).toHaveBeenCalledWith('company-1', 'reg_query', 'query-1', {})
    expect(result.status).toBe('closed')
  })
})

describe('RegQueryService.registerList', () => {
  it('joins product/market/owner and computes isOverdue, filtered by overdueOnly at the DB level', async () => {
    const { service, regQueryFindMany, regQueryCount } = buildHarness()
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    regQueryFindMany.mockResolvedValue([
      {
        id: 'q1',
        status: 'open',
        responseDueDate: yesterday,
        queryTextEncrypted: 'enc(a)',
        regDossier: {
          product: { brandName: 'Panadol' },
          authority: { countryId: 'ke', country: { name: 'Kenya' } },
        },
        owner: { fullName: 'Jane Doe' },
      },
    ])
    regQueryCount.mockResolvedValue(1)

    const result = await service.registerList(actor, {
      page: 1,
      limit: 20,
      overdueOnly: true,
    })

    expect(regQueryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['open', 'in_progress'] },
          responseDueDate: { lt: expect.any(Date) },
        }),
      }),
    )
    expect(result.data).toEqual([
      expect.objectContaining({
        productBrandName: 'Panadol',
        countryId: 'ke',
        countryName: 'Kenya',
        ownerName: 'Jane Doe',
        isOverdue: true,
      }),
    ])
  })
})
