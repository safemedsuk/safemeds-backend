import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CompanyProfileService } from './company-profile.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['SYSTEM_ADMINISTRATOR'],
  platformRole: null,
  tokenVersion: 1,
}
const platformActor: AuthenticatedUser = {
  sub: 'staff-1',
  companyId: null,
  roleKeys: [],
  platformRole: 'super_admin',
  tokenVersion: 1,
}

function buildHarness(
  configValues: Record<string, unknown> = {
    FRONTEND_URL: 'https://app.safemeds.uk',
    EMAIL_INTAKE_DOMAIN: 'intake.safemeds.uk',
  },
) {
  const companies = new Map<string, Record<string, unknown>>([
    [
      'company-1',
      {
        id: 'company-1',
        name: 'FankamMeds Inc',
        publicReportingSlug: null,
        intakeEmailAddress: null,
        whatsappBusinessPhoneNumberId: null,
      },
    ],
  ])

  const findUnique = jest
    .fn()
    .mockImplementation(({ where }: { where: { id?: string } }) =>
      Promise.resolve(where.id ? (companies.get(where.id) ?? null) : null),
    )
  const findFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      const [field, value] = Object.entries(where)[0]
      return Promise.resolve([...companies.values()].find((c) => c[field] === value) ?? null)
    })
  const update = jest
    .fn()
    .mockImplementation(
      ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = companies.get(where.id)!
        const updated = { ...existing, ...data }
        companies.set(where.id, updated)
        return Promise.resolve(updated)
      },
    )

  const tables = {
    company: { findUnique, findFirst, update },
    companyMarket: { findUnique: jest.fn(), create: jest.fn() },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const generatePng = jest.fn().mockResolvedValue(Buffer.from('fake-png-bytes'))
  const qrCodeService = { generatePng } as never
  const configService = { get: (key: string) => configValues[key] } as never

  const service = new CompanyProfileService(
    rls as never,
    auditService,
    qrCodeService,
    configService,
  )
  return { service, companies, auditLog, generatePng }
}

describe('CompanyProfileService — Stage 3.2 public reporting + Stage 3.3/3.4 channel config', () => {
  describe('generatePublicReportingSlug()', () => {
    it('generates a slug from the company name and persists it', async () => {
      const { service, companies, auditLog } = buildHarness()

      const updated = await service.generatePublicReportingSlug(actor, { ip: '1.2.3.4' })

      expect(updated.publicReportingSlug).toBe('fankammeds-inc')
      expect(companies.get('company-1')!.publicReportingSlug).toBe('fankammeds-inc')
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'public_reporting_slug_generated' }),
      )
    })

    it('regenerating produces a different slug (rotation, not idempotent)', async () => {
      const { service } = buildHarness()
      const first = await service.generatePublicReportingSlug(actor, {})
      // Force a collision so the second call must fall back to the random-suffix branch.
      const second = await service.generatePublicReportingSlug(actor, {})
      expect(second.publicReportingSlug).not.toBe(first.publicReportingSlug)
    })

    it('rejects a platform-staff actor with no company context', async () => {
      const { service } = buildHarness()
      await expect(service.generatePublicReportingSlug(platformActor, {})).rejects.toThrow(
        ForbiddenException,
      )
    })
  })

  describe('getPublicReportingQrCode()', () => {
    it('404s clearly when no slug has been generated yet', async () => {
      const { service } = buildHarness()
      await expect(service.getPublicReportingQrCode(actor)).rejects.toThrow(NotFoundException)
    })

    it('generates a PNG encoding the full public reporting URL once a slug exists', async () => {
      const { service, generatePng } = buildHarness()
      await service.generatePublicReportingSlug(actor, {})

      const png = await service.getPublicReportingQrCode(actor)

      expect(png).toBeInstanceOf(Buffer)
      expect(generatePng).toHaveBeenCalledWith('https://app.safemeds.uk/report/fankammeds-inc')
    })
  })

  describe('generateIntakeEmailAddress()', () => {
    it('generates {slug}@{EMAIL_INTAKE_DOMAIN} and persists it', async () => {
      const { service, companies } = buildHarness()

      const updated = await service.generateIntakeEmailAddress(actor, {})

      expect(updated.intakeEmailAddress).toBe('fankammeds-inc@intake.safemeds.uk')
      expect(companies.get('company-1')!.intakeEmailAddress).toBe(
        'fankammeds-inc@intake.safemeds.uk',
      )
    })

    it('throws a clear, typed error when EMAIL_INTAKE_DOMAIN is not configured — never a silent no-op', async () => {
      const { service } = buildHarness({
        FRONTEND_URL: 'https://app.safemeds.uk',
        EMAIL_INTAKE_DOMAIN: undefined,
      })
      await expect(service.generateIntakeEmailAddress(actor, {})).rejects.toThrow(ConflictException)
    })
  })

  describe('setWhatsappPhoneNumberId()', () => {
    it('stores the admin-supplied Meta phone number ID verbatim', async () => {
      const { service, companies, auditLog } = buildHarness()

      const updated = await service.setWhatsappPhoneNumberId(
        actor,
        { whatsappBusinessPhoneNumberId: '109876543210' },
        {},
      )

      expect(updated.whatsappBusinessPhoneNumberId).toBe('109876543210')
      expect(companies.get('company-1')!.whatsappBusinessPhoneNumberId).toBe('109876543210')
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'whatsapp_phone_number_id_set' }),
      )
    })
  })

  describe('update() — testing-correction-explanation.md decision #4', () => {
    it('sets regulatoryContactEmail, previously a genuinely write-never field on this endpoint', async () => {
      const { service, companies } = buildHarness()

      const updated = await service.update(
        actor,
        { regulatoryContactEmail: 'compliance@fankammeds.example' },
        {},
      )

      expect(updated.regulatoryContactEmail).toBe('compliance@fankammeds.example')
      expect(companies.get('company-1')!.regulatoryContactEmail).toBe(
        'compliance@fankammeds.example',
      )
    })

    it('leaves regulatoryContactEmail untouched when omitted from the update', async () => {
      const { service, companies } = buildHarness()
      companies.set('company-1', {
        ...companies.get('company-1')!,
        regulatoryContactEmail: 'already-set@fankammeds.example',
      })

      await service.update(actor, { name: 'FankamMeds Renamed Inc' }, {})

      expect(companies.get('company-1')!.regulatoryContactEmail).toBe(
        'already-set@fankammeds.example',
      )
    })
  })
})
