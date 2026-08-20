import { resolveDefaultReportType } from './default-report-type.util'

function buildTx(reportTypes: Array<{ id: string; typeKey: string; moduleKey: string }>) {
  return {
    reportType: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { typeKey?: string; moduleKey: string } }) =>
          Promise.resolve(
            reportTypes.find(
              (rt) =>
                (where.typeKey ? rt.typeKey === where.typeKey : true) &&
                rt.moduleKey === where.moduleKey,
            ) ?? null,
          ),
        ),
    },
  } as never
}

describe('resolveDefaultReportType()', () => {
  it('resolves the adr report type when one is seeded', async () => {
    const tx = buildTx([
      { id: 'rt-device', typeKey: 'device_incident', moduleKey: 'pv' },
      { id: 'rt-adr', typeKey: 'adr', moduleKey: 'pv' },
    ])

    const result = await resolveDefaultReportType(tx)

    expect(result).toEqual(expect.objectContaining({ id: 'rt-adr' }))
  })

  it('falls back to the first configured pv report type when adr is not seeded', async () => {
    const tx = buildTx([{ id: 'rt-device', typeKey: 'device_incident', moduleKey: 'pv' }])

    const result = await resolveDefaultReportType(tx)

    expect(result).toEqual(expect.objectContaining({ id: 'rt-device' }))
  })

  it('returns null when the company has no pv report type configured at all', async () => {
    const tx = buildTx([])

    const result = await resolveDefaultReportType(tx)

    expect(result).toBeNull()
  })
})
