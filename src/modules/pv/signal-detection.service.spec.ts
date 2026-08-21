import { SignalDetectionService } from './signal-detection.service'

interface Row {
  id: string
  [key: string]: unknown
}

function createTable<T extends Row>(defaults: Partial<T> = {}) {
  const rows = new Map<string, T>()
  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true
      if (
        value !== null &&
        typeof value === 'object' &&
        'notIn' in (value as Record<string, unknown>)
      ) {
        return !(value as { notIn: unknown[] }).notIn.includes(row[key])
      }
      return row[key] === value
    })
  }
  const create = jest.fn().mockImplementation(({ data }: { data: T }) => {
    rows.set(data.id, { ...defaults, ...data })
    return Promise.resolve(rows.get(data.id))
  })
  const findFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].find((r) => matches(r, where)) ?? null),
    )
  const findMany = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {}))),
    )
  const findUnique = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      const [key, value] = Object.entries(where)[0]
      const flattened =
        value !== null && typeof value === 'object'
          ? (value as Record<string, unknown>)
          : { [key]: value }
      return Promise.resolve([...rows.values()].find((r) => matches(r, flattened)) ?? null)
    })
  return { rows, create, findFirst, findMany, findUnique }
}

interface SuspectProductFixture {
  caseId: string
  medicinalProduct: string
  batchNumber: string | null
  organization: string | null
  duplicateOfCaseId?: string | null
  status?: string
}

function buildHarness(suspectProducts: SuspectProductFixture[]) {
  const suspectProductRows = suspectProducts.map((p) => ({
    caseId: p.caseId,
    medicinalProduct: p.medicinalProduct,
    batchNumber: p.batchNumber,
    case: {
      reporter: { organization: p.organization },
      duplicateOfCaseId: p.duplicateOfCaseId ?? null,
      status: p.status ?? 'triage',
    },
  }))

  const tables = {
    signal: createTable({ status: 'detected' }),
    signalCase: createTable(),
    company: createTable(),
    workflowInstance: createTable(),
  }

  const suspectProductFindMany = jest
    .fn()
    .mockImplementation(
      ({ where }: { where: { case: { duplicateOfCaseId: null; status: { notIn: string[] } } } }) =>
        Promise.resolve(
          suspectProductRows.filter(
            (r) =>
              r.case.duplicateOfCaseId === null && !where.case.status.notIn.includes(r.case.status),
          ),
        ),
    )

  const txTables = { ...tables, suspectProduct: { findMany: suspectProductFindMany } }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof txTables) => unknown) => fn(txTables),
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const instantiate = jest.fn().mockResolvedValue({})
  const workflowService = { instantiate } as never

  const createInTx = jest
    .fn()
    .mockImplementation(
      (_tx: unknown, companyId: string, data: Record<string, unknown>): Promise<Row> => {
        return txTables.signal.create({
          data: { id: `sig-${txTables.signal.rows.size + 1}`, companyId, ...data },
        }) as Promise<Row>
      },
    )
  const linkCasesInTx = jest
    .fn()
    .mockImplementation(async (_tx, companyId, signalId, caseIds: string[]) => {
      let newlyLinked = 0
      for (const caseId of caseIds) {
        const existing = [...txTables.signalCase.rows.values()].find(
          (l) => l.signalId === signalId && l.caseId === caseId,
        )
        if (existing) continue
        await txTables.signalCase.create({
          data: { id: `link-${txTables.signalCase.rows.size + 1}`, companyId, signalId, caseId },
        })
        newlyLinked += 1
      }
      return newlyLinked
    })
  const signalService = { createInTx, linkCasesInTx } as never

  const service = new SignalDetectionService(rls as never, signalService, workflowService)
  return { service, tables: txTables, instantiate, createInTx, linkCasesInTx }
}

describe('SignalDetectionService', () => {
  describe('scanCompany() — product-level pattern', () => {
    it('flags the same product across >=2 open cases at >=2 distinct organizations', async () => {
      const { service, tables } = await Promise.resolve(
        buildHarness([
          {
            caseId: 'case-1',
            medicinalProduct: 'Depo-Provera',
            batchNumber: null,
            organization: 'Meridian Pharma',
          },
          {
            caseId: 'case-2',
            medicinalProduct: 'depo-provera',
            batchNumber: null,
            organization: 'Zenith Distributors',
          },
        ]),
      )

      const result = await service.scanCompany('company-1')
      expect(result.signalsCreated).toBe(1)
      expect(result.casesLinked).toBe(2)
      const signal = [...tables.signal.rows.values()][0]
      expect(signal.productIdentifier).toBe('Depo-Provera')
      expect(signal.batchNumber).toBeNull()
    })

    it('does not flag the same product reported by only one organization', async () => {
      const { service } = buildHarness([
        {
          caseId: 'case-1',
          medicinalProduct: 'Panadol',
          batchNumber: null,
          organization: 'Meridian Pharma',
        },
        {
          caseId: 'case-2',
          medicinalProduct: 'Panadol',
          batchNumber: null,
          organization: 'Meridian Pharma',
        },
      ])

      const result = await service.scanCompany('company-1')
      expect(result.signalsCreated).toBe(0)
    })

    it('does not flag a single case even with distinct suspect-product rows', async () => {
      const { service } = buildHarness([
        {
          caseId: 'case-1',
          medicinalProduct: 'Panadol',
          batchNumber: null,
          organization: 'Meridian Pharma',
        },
      ])
      const result = await service.scanCompany('company-1')
      expect(result.signalsCreated).toBe(0)
    })

    it('ignores a case with no reporter organization on record', async () => {
      const { service } = buildHarness([
        { caseId: 'case-1', medicinalProduct: 'Panadol', batchNumber: null, organization: null },
        {
          caseId: 'case-2',
          medicinalProduct: 'Panadol',
          batchNumber: null,
          organization: 'Meridian Pharma',
        },
      ])
      const result = await service.scanCompany('company-1')
      expect(result.signalsCreated).toBe(0)
    })

    it('excludes confirmed duplicate cases from the pattern', async () => {
      const { service } = buildHarness([
        {
          caseId: 'case-1',
          medicinalProduct: 'Panadol',
          batchNumber: null,
          organization: 'Meridian Pharma',
        },
        {
          caseId: 'case-2',
          medicinalProduct: 'Panadol',
          batchNumber: null,
          organization: 'Zenith Distributors',
          duplicateOfCaseId: 'case-1',
        },
      ])
      const result = await service.scanCompany('company-1')
      expect(result.signalsCreated).toBe(0)
    })

    it('excludes a terminal (submitted) case from the pattern', async () => {
      const { service } = buildHarness([
        {
          caseId: 'case-1',
          medicinalProduct: 'Panadol',
          batchNumber: null,
          organization: 'Meridian Pharma',
        },
        {
          caseId: 'case-2',
          medicinalProduct: 'Panadol',
          batchNumber: null,
          organization: 'Zenith Distributors',
          status: 'submitted',
        },
      ])
      const result = await service.scanCompany('company-1')
      expect(result.signalsCreated).toBe(0)
    })
  })

  describe('scanCompany() — batch-level pattern', () => {
    it('creates a more specific batch-level signal alongside the broader product-level one', async () => {
      const { service, instantiate } = buildHarness([
        {
          caseId: 'case-1',
          medicinalProduct: 'Depo-Provera',
          batchNumber: 'B12345',
          organization: 'Meridian Pharma',
        },
        {
          caseId: 'case-2',
          medicinalProduct: 'Depo-Provera',
          batchNumber: 'B12345',
          organization: 'Zenith Distributors',
        },
      ])

      const result = await service.scanCompany('company-1')
      // Both the batch-specific and the product-wide groups qualify from this same evidence — two independent signals.
      expect(result.signalsCreated).toBe(2)
      expect(instantiate).toHaveBeenCalledTimes(2)
    })
  })

  describe('scanCompany() — idempotency', () => {
    it('does not create a second signal for the same product/batch on a re-scan, only links any new case', async () => {
      const harness = buildHarness([
        {
          caseId: 'case-1',
          medicinalProduct: 'Panadol',
          batchNumber: null,
          organization: 'Meridian Pharma',
        },
        {
          caseId: 'case-2',
          medicinalProduct: 'Panadol',
          batchNumber: null,
          organization: 'Zenith Distributors',
        },
      ])

      const first = await harness.service.scanCompany('company-1')
      expect(first.signalsCreated).toBe(1)

      const second = await harness.service.scanCompany('company-1')
      expect(second.signalsCreated).toBe(0)
      expect(second.casesLinked).toBe(0) // same two cases, already linked
      expect(harness.tables.signal.rows.size).toBe(1)
    })

    it('links a genuinely new case to the existing open signal on a re-scan', async () => {
      const harness = buildHarness([
        {
          caseId: 'case-1',
          medicinalProduct: 'Panadol',
          batchNumber: null,
          organization: 'Meridian Pharma',
        },
        {
          caseId: 'case-2',
          medicinalProduct: 'Panadol',
          batchNumber: null,
          organization: 'Zenith Distributors',
        },
      ])
      await harness.service.scanCompany('company-1')

      harness.tables.suspectProduct.findMany = jest.fn().mockResolvedValue([
        {
          caseId: 'case-1',
          medicinalProduct: 'Panadol',
          batchNumber: null,
          case: {
            reporter: { organization: 'Meridian Pharma' },
            duplicateOfCaseId: null,
            status: 'triage',
          },
        },
        {
          caseId: 'case-2',
          medicinalProduct: 'Panadol',
          batchNumber: null,
          case: {
            reporter: { organization: 'Zenith Distributors' },
            duplicateOfCaseId: null,
            status: 'triage',
          },
        },
        {
          caseId: 'case-3',
          medicinalProduct: 'Panadol',
          batchNumber: null,
          case: {
            reporter: { organization: 'Acme Health' },
            duplicateOfCaseId: null,
            status: 'triage',
          },
        },
      ] as never)

      const second = await harness.service.scanCompany('company-1')
      expect(second.signalsCreated).toBe(0)
      expect(second.casesLinked).toBe(1)
    })
  })
})
