import { RegLicensingExpiryService } from './reg-licensing-expiry.service'

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const escalateForRecord = jest.fn().mockResolvedValue(undefined)
  const tasksService = { escalateForRecord } as never
  const notificationCreate = jest.fn().mockResolvedValue(undefined)
  const notificationsService = { create: notificationCreate } as never

  const facilityFindMany = jest.fn().mockResolvedValue([])
  const facilityUpdate = jest.fn().mockResolvedValue(undefined)
  const personnelFindMany = jest.fn().mockResolvedValue([])
  const personnelUpdate = jest.fn().mockResolvedValue(undefined)
  const permitFindMany = jest.fn().mockResolvedValue([])
  const permitUpdate = jest.fn().mockResolvedValue(undefined)
  const userFindMany = jest.fn().mockResolvedValue([])

  const tables = {
    facility: { findMany: facilityFindMany, update: facilityUpdate },
    personnelLicence: { findMany: personnelFindMany, update: personnelUpdate },
    importExportPermit: { findMany: permitFindMany, update: permitUpdate },
    user: { findMany: userFindMany },
  }

  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new RegLicensingExpiryService(
    rls as never,
    auditService,
    tasksService,
    notificationsService,
  )
  return {
    service,
    auditLog,
    escalateForRecord,
    notificationCreate,
    facilityFindMany,
    facilityUpdate,
    personnelFindMany,
    personnelUpdate,
    permitFindMany,
    permitUpdate,
    userFindMany,
  }
}

describe('RegLicensingExpiryService.scan', () => {
  it('flips an expired facility licence to expired and escalates', async () => {
    const { service, facilityFindMany, facilityUpdate, escalateForRecord } = buildHarness()
    facilityFindMany.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        'lt' in ((where.licenceExpiresOn as Record<string, unknown>) ?? {})
          ? [
              {
                id: 'facility-1',
                companyId: 'company-1',
                name: 'Main Pharmacy',
                licenceNumber: 'LIC-1',
                licenceExpiresOn: new Date('2020-01-01'),
              },
            ]
          : [],
      ),
    )

    const result = await service.scan()

    expect(result.expired).toBe(1)
    expect(facilityUpdate).toHaveBeenCalledWith({
      where: { id: 'facility-1' },
      data: { licenceStatus: 'expired' },
    })
    expect(escalateForRecord).toHaveBeenCalledWith(
      'company-1',
      'facility',
      'facility-1',
      'overdue',
      expect.stringMatching(/EXPIRED/),
      {},
    )
  })

  it('sends exactly one approaching-reminder per facility, guarded by licenceRenewalNotifiedAt', async () => {
    const { service, facilityFindMany, facilityUpdate, escalateForRecord } = buildHarness()
    facilityFindMany.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      if ('lt' in ((where.licenceExpiresOn as Record<string, unknown>) ?? {}))
        return Promise.resolve([])
      return Promise.resolve([
        {
          id: 'facility-2',
          companyId: 'company-1',
          name: 'Branch Pharmacy',
          licenceNumber: 'LIC-2',
          licenceExpiresOn: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      ])
    })

    const result = await service.scan()

    expect(result.approaching).toBe(1)
    expect(facilityUpdate).toHaveBeenCalledWith({
      where: { id: 'facility-2' },
      data: { licenceRenewalNotifiedAt: expect.any(Date) },
    })
    expect(escalateForRecord).toHaveBeenCalledWith(
      'company-1',
      'facility',
      'facility-2',
      'due_soon',
      expect.stringMatching(/approaching/),
      {},
    )
  })

  it('flips an expired personnel licence to expired and escalates', async () => {
    const { service, personnelFindMany, personnelUpdate, escalateForRecord } = buildHarness()
    personnelFindMany.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        'lt' in ((where.expiresOn as Record<string, unknown>) ?? {})
          ? [
              {
                id: 'licence-1',
                companyId: 'company-1',
                licenceType: 'pharmacist',
                licenceNumber: 'PH-1',
                expiresOn: new Date('2020-01-01'),
              },
            ]
          : [],
      ),
    )

    const result = await service.scan()

    expect(result.expired).toBe(1)
    expect(personnelUpdate).toHaveBeenCalledWith({
      where: { id: 'licence-1' },
      data: { status: 'expired' },
    })
    expect(escalateForRecord).toHaveBeenCalledWith(
      'company-1',
      'personnel_licence',
      'licence-1',
      'overdue',
      expect.stringMatching(/EXPIRED/),
      {},
    )
  })

  it('flips an expired import/export permit to expired and escalates', async () => {
    const { service, permitFindMany, permitUpdate, escalateForRecord } = buildHarness()
    permitFindMany.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        'lt' in ((where.validTo as Record<string, unknown>) ?? {})
          ? [
              {
                id: 'permit-1',
                companyId: 'company-1',
                permitType: 'import',
                permitNumber: 'IMP-1',
                validTo: new Date('2020-01-01'),
              },
            ]
          : [],
      ),
    )

    const result = await service.scan()

    expect(result.expired).toBe(1)
    expect(permitUpdate).toHaveBeenCalledWith({
      where: { id: 'permit-1' },
      data: { status: 'expired' },
    })
    expect(escalateForRecord).toHaveBeenCalledWith(
      'company-1',
      'import_export_permit',
      'permit-1',
      'overdue',
      expect.stringMatching(/EXPIRED/),
      {},
    )
  })

  it('reports all zeros when nothing needs flagging', async () => {
    const { service } = buildHarness()
    const result = await service.scan()
    expect(result).toEqual({ expired: 0, approaching: 0 })
  })
})
