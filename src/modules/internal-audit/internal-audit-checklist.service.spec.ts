import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { InternalAuditChecklistService } from './internal-audit-checklist.service'

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

  const internalAuditFindFirst = jest.fn()
  const internalAuditUpdate = jest.fn().mockResolvedValue({})
  const companyFindUniqueOrThrow = jest.fn().mockResolvedValue({ homeCountryId: 'ke' })
  const templateFindMany = jest.fn().mockResolvedValue([])
  const responseUpsert = jest.fn().mockImplementation(({ create }) => Promise.resolve(create))
  const responseFindMany = jest.fn().mockResolvedValue([])
  const responseFindFirst = jest.fn()
  const responseUpdate = jest
    .fn()
    .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))

  const tables = {
    internalAudit: { findFirst: internalAuditFindFirst, update: internalAuditUpdate },
    company: { findUniqueOrThrow: companyFindUniqueOrThrow },
    inspectionChecklistTemplate: { findMany: templateFindMany },
    internalAuditChecklistResponse: {
      upsert: responseUpsert,
      findMany: responseFindMany,
      findFirst: responseFindFirst,
      update: responseUpdate,
    },
  }
  const rls = { runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables) }

  const service = new InternalAuditChecklistService(rls as never, auditService)
  return {
    service,
    auditLog,
    internalAuditFindFirst,
    internalAuditUpdate,
    templateFindMany,
    responseUpsert,
    responseFindMany,
    responseFindFirst,
    responseUpdate,
  }
}

describe('InternalAuditChecklistService.startConduct', () => {
  it('404s starting conduct on an audit that does not exist', async () => {
    const { service, internalAuditFindFirst } = buildHarness()
    internalAuditFindFirst.mockResolvedValue(null)

    await expect(service.startConduct(actor, 'ghost', {})).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  it('instantiates one response row per active checklist template for the company home authority, and moves a scheduled audit to in_progress', async () => {
    const { service, internalAuditFindFirst, templateFindMany, responseUpsert, internalAuditUpdate } =
      buildHarness()
    internalAuditFindFirst.mockResolvedValue({ id: 'audit-1', status: 'scheduled' })
    templateFindMany.mockResolvedValue([
      { id: 'template-1', sortOrder: 1 },
      { id: 'template-2', sortOrder: 2 },
    ])

    const result = await service.startConduct(actor, 'audit-1', {})

    expect(responseUpsert).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(2)
    expect(internalAuditUpdate).toHaveBeenCalledWith({
      where: { id: 'audit-1' },
      data: { status: 'in_progress' },
    })
  })

  it('does not force an already in_progress audit back to in_progress', async () => {
    const { service, internalAuditFindFirst, internalAuditUpdate } = buildHarness()
    internalAuditFindFirst.mockResolvedValue({ id: 'audit-1', status: 'in_progress' })

    await service.startConduct(actor, 'audit-1', {})
    expect(internalAuditUpdate).not.toHaveBeenCalled()
  })
})

describe('InternalAuditChecklistService.respond', () => {
  it('404s responding to a checklist item that does not exist', async () => {
    const { service, responseFindFirst } = buildHarness()
    responseFindFirst.mockResolvedValue(null)

    await expect(
      service.respond(actor, 'ghost', { status: 'compliant' }, {}),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })

  it('records the status, observations, and reviewer', async () => {
    const { service, responseFindFirst, responseUpdate } = buildHarness()
    responseFindFirst.mockResolvedValue({ id: 'response-1', observations: null })

    await service.respond(actor, 'response-1', { status: 'non_compliant', observations: 'Door seal cracked.' }, {})

    expect(responseUpdate).toHaveBeenCalledWith({
      where: { id: 'response-1' },
      data: {
        status: 'non_compliant',
        observations: 'Door seal cracked.',
        reviewedBy: 'user-1',
        reviewedAt: expect.any(Date),
      },
    })
  })
})
