import { BadRequestException } from '@nestjs/common'

import { InboundEmailWebhookPayload } from './dto/inbound-email-webhook.dto'
import { EmailIntakeService } from './email-intake.service'

function buildHarness() {
  const companies = new Map([
    [
      'company-1',
      {
        id: 'company-1',
        name: 'FankamMeds Inc',
        intakeEmailAddress: 'fankammeds-inc@intake.safemeds.uk',
        status: 'active',
        homeCountryId: 'country-ke',
      },
    ],
  ])
  const reportTypes = [{ id: 'report-type-adr', typeKey: 'adr', moduleKey: 'pv' }]

  const tables = {
    company: {
      findFirst: jest
        .fn()
        .mockImplementation(
          ({ where }: { where: { intakeEmailAddress: string; status: string } }) =>
            Promise.resolve(
              [...companies.values()].find(
                (c) =>
                  c.intakeEmailAddress === where.intakeEmailAddress && c.status === where.status,
              ) ?? null,
            ),
        ),
    },
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
  }
  const rls = { runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables) }

  const createFromSystemChannel = jest
    .fn()
    .mockResolvedValue({ id: 'case-1', referenceNumber: 'PV-2026-00001' })
  const pvCaseService = { createFromSystemChannel } as never

  const sendCaseIntakeFollowUp = jest.fn().mockResolvedValue(undefined)
  const sendCaseReceivedConfirmation = jest.fn().mockResolvedValue(undefined)
  const mailService = { sendCaseIntakeFollowUp, sendCaseReceivedConfirmation } as never

  const service = new EmailIntakeService(rls as never, pvCaseService, mailService)
  return { service, createFromSystemChannel, sendCaseIntakeFollowUp, sendCaseReceivedConfirmation }
}

function payload(
  overrides: Partial<InboundEmailWebhookPayload['data']> = {},
): InboundEmailWebhookPayload {
  return {
    type: 'email.received',
    data: {
      from: 'reporter@example.com',
      to: 'fankammeds-inc@intake.safemeds.uk',
      subject: 'Bad reaction to my medicine',
      text: 'Patient Age: 34\nPatient Sex: Female\nProduct: Amoxil 500mg\nAdverse Event: Severe rash within two hours',
      ...overrides,
    },
  }
}

describe('EmailIntakeService', () => {
  describe('processInboundEmail()', () => {
    it('creates a draft case when all minimum-criteria fields are extractable', async () => {
      const { service, createFromSystemChannel } = buildHarness()

      const result = await service.processInboundEmail(payload(), {})

      expect(result).toEqual({ outcome: 'case_created', referenceNumber: 'PV-2026-00001' })
      expect(createFromSystemChannel).toHaveBeenCalledWith(
        'company-1',
        expect.objectContaining({
          reportTypeId: 'report-type-adr',
          countryOfOccurrenceId: 'country-ke',
          countryOfReportId: 'country-ke',
          reporter: expect.objectContaining({
            reporterType: 'consumer',
            email: 'reporter@example.com',
          }),
          patient: expect.objectContaining({ ageYears: 34, sex: 'female' }),
          suspectProducts: [expect.objectContaining({ medicinalProduct: 'Amoxil 500mg' })],
          adverseEvents: [
            expect.objectContaining({ reportedTerm: 'Severe rash within two hours' }),
          ],
        }),
        'drug_safety_email',
        null,
        {},
      )
    })

    it('replies to the reporter with a real receipt confirmation once the case is created — Stage 3.3', async () => {
      const { service, sendCaseReceivedConfirmation } = buildHarness()

      await service.processInboundEmail(payload(), {})

      expect(sendCaseReceivedConfirmation).toHaveBeenCalledWith(
        'reporter@example.com',
        'FankamMeds Inc',
        'PV-2026-00001',
      )
    })

    it('marks the reporter as healthcare_professional when the body contains HCP context keywords', async () => {
      const { service, createFromSystemChannel } = buildHarness()
      await service.processInboundEmail(
        payload({
          text: 'Reporter Name: Dr. Otieno\nPatient Age: 40\nPatient Sex: Male\nProduct: Panadol\nEvent: Nausea',
        }),
        {},
      )

      const [, dto] = createFromSystemChannel.mock.calls[0]
      expect(dto.reporter.reporterType).toBe('healthcare_professional')
      expect(dto.reporter.fullName).toBe('Dr. Otieno')
    })

    it('extracts an HTML-only body by stripping tags before running extraction', async () => {
      const { service, createFromSystemChannel } = buildHarness()
      await service.processInboundEmail(
        payload({
          text: undefined,
          html: '<p>Patient Age: 29</p><p>Patient Sex: Male</p><p>Product: Panadol</p><p>Event: Hives</p>',
        }),
        {},
      )

      expect(createFromSystemChannel).toHaveBeenCalled()
      const [, dto] = createFromSystemChannel.mock.calls[0]
      expect(dto.patient.ageYears).toBe(29)
    })

    it('passes the MIME Message-Id through as sourceChannelReference', async () => {
      const { service, createFromSystemChannel } = buildHarness()
      await service.processInboundEmail(payload({ messageId: '<abc123@mail.example.com>' }), {})

      expect(createFromSystemChannel).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        'drug_safety_email',
        '<abc123@mail.example.com>',
        {},
      )
    })

    it('sends an automated follow-up, and does not create a case, when minimum criteria are not extractable', async () => {
      const { service, createFromSystemChannel, sendCaseIntakeFollowUp } = buildHarness()

      const result = await service.processInboundEmail(
        payload({ text: 'Hi, I felt unwell after taking something yesterday.' }),
        {},
      )

      expect(result).toEqual({ outcome: 'follow_up_sent' })
      expect(createFromSystemChannel).not.toHaveBeenCalled()
      expect(sendCaseIntakeFollowUp).toHaveBeenCalledWith(
        'reporter@example.com',
        'FankamMeds Inc',
        expect.arrayContaining(['patient information (age, sex, or initials)']),
        'Bad reaction to my medicine',
      )
    })

    it('logs and returns unrecognized_recipient for an address no tenant owns, without creating a case or sending mail', async () => {
      const { service, createFromSystemChannel, sendCaseIntakeFollowUp } = buildHarness()

      const result = await service.processInboundEmail(
        payload({ to: 'unknown-slug@intake.safemeds.uk' }),
        {},
      )

      expect(result).toEqual({ outcome: 'unrecognized_recipient' })
      expect(createFromSystemChannel).not.toHaveBeenCalled()
      expect(sendCaseIntakeFollowUp).not.toHaveBeenCalled()
    })

    it('resolves the recipient address whether "to" is a bare string or a one-element array', async () => {
      const { service, createFromSystemChannel } = buildHarness()
      await service.processInboundEmail(payload({ to: ['fankammeds-inc@intake.safemeds.uk'] }), {})
      expect(createFromSystemChannel).toHaveBeenCalled()
    })

    it('resolves the sender address from an RFC 5322 "Display Name <addr>" form', async () => {
      const { service, createFromSystemChannel } = buildHarness()
      await service.processInboundEmail(
        payload({ from: 'Jane Reporter <reporter@example.com>' }),
        {},
      )
      const [, dto] = createFromSystemChannel.mock.calls[0]
      expect(dto.reporter.email).toBe('reporter@example.com')
    })

    it('resolves the sender address from a { email, name } object form', async () => {
      const { service, createFromSystemChannel } = buildHarness()
      await service.processInboundEmail(
        payload({ from: { email: 'reporter@example.com', name: 'Jane Reporter' } }),
        {},
      )
      const [, dto] = createFromSystemChannel.mock.calls[0]
      expect(dto.reporter.email).toBe('reporter@example.com')
    })

    it('throws BadRequestException when the payload has no recognizable to/from address', async () => {
      const { service } = buildHarness()
      await expect(
        service.processInboundEmail(payload({ to: undefined, from: undefined }), {}),
      ).rejects.toThrow(BadRequestException)
    })
  })
})
