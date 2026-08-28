import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PersonnelLicenceService } from './personnel-licence.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog }

  const userFindFirst = jest.fn().mockResolvedValue({ id: 'user-2', companyId: 'company-1' })
  const licenceFindMany = jest.fn().mockResolvedValue([])
  const licenceCount = jest.fn().mockResolvedValue(0)
  const licenceFindFirst = jest
    .fn()
    .mockResolvedValue({
      id: 'licence-1',
      companyId: 'company-1',
      expiresOn: new Date('2027-01-01'),
    })
  const licenceCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const licenceUpdate = jest
    .fn()
    .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))

  const tables = {
    user: { findFirst: userFindFirst },
    personnelLicence: {
      findMany: licenceFindMany,
      count: licenceCount,
      findFirst: licenceFindFirst,
      create: licenceCreate,
      update: licenceUpdate,
    },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new PersonnelLicenceService(rls as never, auditService as never)
  return { service, auditLog, userFindFirst, licenceFindFirst, licenceCreate, licenceUpdate }
}

describe('PersonnelLicenceService.create', () => {
  it('creates a licence and audits it', async () => {
    const { service, licenceCreate, auditLog } = buildHarness()

    await service.create(
      actor,
      {
        userId: 'user-2',
        licenceType: 'pharmacist',
        licenceNumber: 'PH-2026-01',
        issuedOn: '2026-01-01',
      },
      {},
    )

    expect(licenceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-2',
          licenceType: 'pharmacist',
          licenceNumber: 'PH-2026-01',
        }),
      }),
    )
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'personnel_licence_created' }),
    )
  })

  it('404s when the user does not belong to this company', async () => {
    const { service, userFindFirst } = buildHarness()
    userFindFirst.mockResolvedValue(null)

    await expect(
      service.create(
        actor,
        {
          userId: 'other-co-user',
          licenceType: 'pharmacist',
          licenceNumber: 'PH-1',
          issuedOn: '2026-01-01',
        },
        {},
      ),
    ).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })
})

describe('PersonnelLicenceService.update', () => {
  it('clears the renewal-reminder guard whenever a new expiresOn is recorded', async () => {
    const { service, licenceUpdate } = buildHarness()

    await service.update(actor, 'licence-1', { expiresOn: '2032-01-01' }, {})

    expect(licenceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          expiresOn: new Date('2032-01-01'),
          renewalNotifiedAt: null,
        }),
      }),
    )
  })

  it('marks a licence status without touching unrelated fields', async () => {
    const { service, licenceUpdate } = buildHarness()

    await service.update(actor, 'licence-1', { status: 'suspended' }, {})

    expect(licenceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'suspended' } }),
    )
  })

  it('404s for a licence in another company (invisible under RLS)', async () => {
    const { service, licenceFindFirst } = buildHarness()
    licenceFindFirst.mockResolvedValue(null)

    await expect(
      service.update(actor, 'other-co-licence', { status: 'expired' }, {}),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })
})
