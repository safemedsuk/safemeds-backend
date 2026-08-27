import { NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { SafetyLetterService } from './safety-letter.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
  platformRole: null,
  tokenVersion: 1,
}

interface Row {
  id: string
  [key: string]: unknown
}

function createTable<T extends Row>(defaults: Partial<T> = {}) {
  const rows = new Map<string, T>()
  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) =>
      value === undefined ? true : row[key] === value,
    )
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
  const findUniqueOrThrow = jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
    const row = rows.get(where.id)
    if (!row) throw new Error('not found')
    return Promise.resolve(row)
  })
  const findMany = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {}))),
    )
  const updateMany = jest
    .fn()
    .mockImplementation(
      ({ where, data }: { where: { id: { in: string[] } }; data: Partial<T> }) => {
        let count = 0
        for (const id of where.id.in) {
          const existing = rows.get(id)
          if (existing) {
            rows.set(id, { ...existing, ...data })
            count += 1
          }
        }
        return Promise.resolve({ count })
      },
    )
  return { rows, create, findFirst, findUniqueOrThrow, findMany, updateMany }
}

function buildHarness() {
  const tables = {
    safetyAlert: createTable({ status: 'open' }),
    company: createTable(),
    product: createTable(),
    generatedReport: createTable(),
    safetyLetterRecipient: createTable({ sentAt: null }),
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const uploadDirect = jest
    .fn()
    .mockResolvedValue({ document: { id: 'doc-1' }, version: { id: 'ver-1' } })
  const documentsService = { uploadDirect } as never

  const render = jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake'))
  const pdfService = { render } as never

  const sendExternalEmail = jest.fn().mockResolvedValue(undefined)
  const notificationsService = { sendExternalEmail } as never

  const service = new SafetyLetterService(
    rls as never,
    auditService,
    documentsService,
    pdfService,
    notificationsService,
  )
  return { service, tables, auditLog, uploadDirect, render, sendExternalEmail }
}

describe('SafetyLetterService', () => {
  describe('generate()', () => {
    it('renders a PDF, uploads it, and creates a recipient row per addressee', async () => {
      const { service, tables, render, uploadDirect } = buildHarness()
      tables.company.rows.set('company-1', { id: 'company-1', name: 'Nairobi Vigil Labs' })
      tables.safetyAlert.rows.set('alert-1', {
        id: 'alert-1',
        companyId: 'company-1',
        title: 'Batch withdrawal',
        summary: 'A batch was recalled abroad.',
      })

      const letter = await service.generate(
        actor,
        {
          safetyAlertId: 'alert-1',
          letterType: 'dhcp',
          ppbApprovalReference: 'PPB/2026/0042',
          backgroundInformation: 'This batch failed a sterility check.',
          actionableGuidance: 'Please stop dispensing this batch.',
          signatoryName: 'Dr. Jane QPPV',
          recipients: [
            { name: 'Dr A', email: 'a@example.com' },
            { name: 'Dr B', email: 'b@example.com' },
          ],
        },
        {},
      )

      expect(render).toHaveBeenCalledWith(
        expect.objectContaining({ letterType: 'dhcp', alertTitle: 'Batch withdrawal' }),
      )
      expect(uploadDirect).toHaveBeenCalled()
      expect(letter.reportTypeKey).toBe('dhcp_letter')
      expect(letter.recipients).toHaveLength(2)
      expect(letter.recipients.every((r) => r.sentAt === undefined || r.sentAt === null)).toBe(true)
    })

    it('resolves the product name when productId is supplied', async () => {
      const { service, tables, render } = buildHarness()
      tables.company.rows.set('company-1', { id: 'company-1', name: 'Nairobi Vigil Labs' })
      tables.safetyAlert.rows.set('alert-1', {
        id: 'alert-1',
        companyId: 'company-1',
        title: 'x',
        summary: 'y',
      })
      tables.product.rows.set('product-1', {
        id: 'product-1',
        companyId: 'company-1',
        brandName: 'Depo-Provera',
      })

      await service.generate(
        actor,
        {
          safetyAlertId: 'alert-1',
          letterType: 'dil',
          productId: 'product-1',
          ppbApprovalReference: 'PPB/2026/0043',
          backgroundInformation: 'bg',
          actionableGuidance: 'z',
          signatoryName: 'Dr. Jane QPPV',
          recipients: [{ name: 'Dr A', email: 'a@example.com' }],
        },
        {},
      )

      expect(render).toHaveBeenCalledWith(expect.objectContaining({ productName: 'Depo-Provera' }))
    })

    it('stores the structured content (PPB approval reference, sections, signatory) on the generated report, and passes it to the PDF renderer', async () => {
      const { service, tables, render } = buildHarness()
      tables.company.rows.set('company-1', { id: 'company-1', name: 'Nairobi Vigil Labs' })
      tables.safetyAlert.rows.set('alert-1', {
        id: 'alert-1',
        companyId: 'company-1',
        title: 'x',
        summary: 'y',
      })

      const letter = await service.generate(
        actor,
        {
          safetyAlertId: 'alert-1',
          letterType: 'dhcp',
          ppbApprovalReference: 'PPB/2026/0099',
          backgroundInformation: 'Real background.',
          actionableGuidance: 'Real guidance.',
          signatoryName: 'Dr. Jane QPPV',
          recipients: [{ name: 'Dr A', email: 'a@example.com' }],
        },
        {},
      )

      expect(letter.content).toMatchObject({
        ppbApprovalReference: 'PPB/2026/0099',
        backgroundInformation: 'Real background.',
        actionableGuidance: 'Real guidance.',
        signatoryName: 'Dr. Jane QPPV',
        signatoryTitle: 'Medical Director / QPPV',
      })
      expect(render).toHaveBeenCalledWith(
        expect.objectContaining({
          ppbApprovalReference: 'PPB/2026/0099',
          backgroundInformation: 'Real background.',
          actionableGuidance: 'Real guidance.',
          signatoryName: 'Dr. Jane QPPV',
        }),
      )
    })

    it('404s on an unknown safety alert', async () => {
      const { service } = buildHarness()
      await expect(
        service.generate(
          actor,
          {
            safetyAlertId: 'nonexistent',
            letterType: 'dhcp',
            ppbApprovalReference: 'PPB/2026/0044',
            backgroundInformation: 'bg',
            actionableGuidance: 'x',
            signatoryName: 'Dr. Jane QPPV',
            recipients: [{ name: 'A', email: 'a@example.com' }],
          },
          {},
        ),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('dispatch()', () => {
    it('emails every unsent recipient and marks them sent', async () => {
      const { service, tables, sendExternalEmail } = buildHarness()
      tables.company.rows.set('company-1', { id: 'company-1', name: 'Nairobi Vigil Labs' })
      tables.safetyAlert.rows.set('alert-1', {
        id: 'alert-1',
        companyId: 'company-1',
        title: 'x',
        summary: 'y',
      })

      const letter = await service.generate(
        actor,
        {
          safetyAlertId: 'alert-1',
          letterType: 'dhcp',
          ppbApprovalReference: 'PPB/2026/0043',
          backgroundInformation: 'bg',
          actionableGuidance: 'z',
          signatoryName: 'Dr. Jane QPPV',
          recipients: [{ name: 'Dr A', email: 'a@example.com' }],
        },
        {},
      )
      const dispatched = await service.dispatch(actor, letter.id, {})

      expect(sendExternalEmail).toHaveBeenCalledTimes(1)
      expect(dispatched.recipients[0].sentAt).toBeInstanceOf(Date)
    })

    it('does not re-email a recipient already marked sent', async () => {
      const { service, tables, sendExternalEmail } = buildHarness()
      tables.company.rows.set('company-1', { id: 'company-1', name: 'Nairobi Vigil Labs' })
      tables.safetyAlert.rows.set('alert-1', {
        id: 'alert-1',
        companyId: 'company-1',
        title: 'x',
        summary: 'y',
      })

      const letter = await service.generate(
        actor,
        {
          safetyAlertId: 'alert-1',
          letterType: 'dhcp',
          ppbApprovalReference: 'PPB/2026/0043',
          backgroundInformation: 'bg',
          actionableGuidance: 'z',
          signatoryName: 'Dr. Jane QPPV',
          recipients: [{ name: 'Dr A', email: 'a@example.com' }],
        },
        {},
      )
      await service.dispatch(actor, letter.id, {})
      sendExternalEmail.mockClear()

      await service.dispatch(actor, letter.id, {})
      expect(sendExternalEmail).not.toHaveBeenCalled()
    })

    it('testing-todo 18.2 — sends the real alert title/summary/product name in the body, not a bare placeholder sentence', async () => {
      const { service, tables, sendExternalEmail } = buildHarness()
      tables.company.rows.set('company-1', { id: 'company-1', name: 'Nairobi Vigil Labs' })
      tables.safetyAlert.rows.set('alert-1', {
        id: 'alert-1',
        companyId: 'company-1',
        title: 'Batch withdrawal — Lot 4471B',
        summary:
          'Confirmed sterility failure in three units from this lot; discontinue use immediately.',
        affectedProductId: 'product-1',
      })
      tables.product.rows.set('product-1', {
        id: 'product-1',
        companyId: 'company-1',
        brandName: 'Depo-Provera',
      })
      // The mock findFirst can't resolve a real Prisma `include`, so wire the
      // relation onto the row directly the way a real `include` would shape it.
      const alertRow = tables.safetyAlert.rows.get('alert-1')!
      ;(alertRow as Record<string, unknown>).affectedProduct = { brandName: 'Depo-Provera' }

      const letter = await service.generate(
        actor,
        {
          safetyAlertId: 'alert-1',
          letterType: 'dhcp',
          productId: 'product-1',
          ppbApprovalReference: 'PPB/2026/0043',
          backgroundInformation: 'bg',
          actionableGuidance: 'z',
          signatoryName: 'Dr. Jane QPPV',
          recipients: [{ name: 'Dr A', email: 'a@example.com' }],
        },
        {},
      )
      await service.dispatch(actor, letter.id, {})

      expect(sendExternalEmail).toHaveBeenCalledTimes(1)
      const [, , bodyText] = sendExternalEmail.mock.calls[0]
      expect(bodyText).toContain('Nairobi Vigil Labs')
      expect(bodyText).toContain('Dear Healthcare Professional Letter')
      expect(bodyText).toContain('Depo-Provera')
      expect(bodyText).toContain('Batch withdrawal — Lot 4471B')
      expect(bodyText).toContain(
        'Confirmed sterility failure in three units from this lot; discontinue use immediately.',
      )
      expect(bodyText).not.toBe(
        `A safety communication (${letter.title}) has been issued for your attention.`,
      )
    })
  })
})
