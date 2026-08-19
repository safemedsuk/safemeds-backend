import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CallLogService } from './call-log.service'
import { LogCallDto } from './dto/log-call.dto'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['DISPENSING_PHARMACIST'],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness(existingDocumentIds: string[] = ['doc-1']) {
  const rows: Record<string, unknown>[] = []
  const tables = {
    callLog: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        rows.push(data)
        return Promise.resolve(data)
      }),
      findMany: jest.fn().mockImplementation(() => Promise.resolve(rows)),
      count: jest.fn().mockResolvedValue(rows.length),
    },
    document: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve(existingDocumentIds.includes(where.id) ? { id: where.id } : null),
        ),
    },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const create = jest.fn().mockResolvedValue({ id: 'case-1', referenceNumber: 'PV-2026-00001' })
  const pvCaseService = { create } as never

  const textEncryption = {
    encrypt: jest.fn((s: string) => `enc(${s})`),
    decrypt: jest.fn((s: string) => s.replace(/^enc\(/, '').replace(/\)$/, '')),
  } as never

  const service = new CallLogService(rls as never, auditService, pvCaseService, textEncryption)
  return { service, tables, auditLog, createCase: create }
}

const baseCallDto: LogCallDto = {
  callerNumber: '+254700000001',
  occurredAt: '2026-08-07T10:00:00.000Z',
  outcome: 'information_only',
}

describe('CallLogService', () => {
  describe('create()', () => {
    it('creates a plain call log with no case when outcome is not case_created', async () => {
      const { service, tables, auditLog, createCase } = buildHarness()

      const result = await service.create(actor, baseCallDto, {})

      expect(result).toMatchObject({
        callerNumber: '+254700000001',
        outcome: 'information_only',
        caseId: null,
      })
      expect(createCase).not.toHaveBeenCalled()
      expect(tables.callLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ companyId: 'company-1', loggedBy: 'user-1' }),
        }),
      )
      expect(auditLog).toHaveBeenCalledWith(
        tables,
        expect.objectContaining({
          action: 'pv_call_logged',
          companyId: 'company-1',
          actorUserId: 'user-1',
        }),
      )
    })

    it('creates the case through PvCaseService.create() with channel forced to hotline_phone, and links it', async () => {
      const { service, createCase } = buildHarness()
      const caseInput = {
        reportTypeId: 'rt-1',
        countryOfOccurrenceId: 'country-1',
        countryOfReportId: 'country-1',
        channel: 'form' as const, // deliberately wrong — must be overridden
        awarenessDate: '2026-08-01',
        receivedDate: '2026-08-01',
        reporter: { reporterType: 'consumer' as const },
        patient: {},
        suspectProducts: [
          { drugCharacterization: 'suspect' as const, medicinalProduct: 'Panadol' },
        ],
        adverseEvents: [{ reportedTerm: 'Nausea', narrative: 'Felt nauseous' }],
      }

      const result = await service.create(
        actor,
        { ...baseCallDto, outcome: 'case_created', case: caseInput },
        {},
      )

      expect(createCase).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({ ...caseInput, channel: 'hotline_phone' }),
        {},
      )
      expect(result).toMatchObject({ caseId: 'case-1' })
    })

    it('400s when outcome is case_created but no case details were provided', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(actor, { ...baseCallDto, outcome: 'case_created' }, {}),
      ).rejects.toThrow(BadRequestException)
    })

    it('400s when case details are provided but outcome is not case_created', async () => {
      const { service } = buildHarness()
      const dto = {
        ...baseCallDto,
        outcome: 'information_only' as const,
        case: {
          reportTypeId: 'rt-1',
          countryOfOccurrenceId: 'country-1',
          countryOfReportId: 'country-1',
          awarenessDate: '2026-08-01',
          receivedDate: '2026-08-01',
          reporter: { reporterType: 'consumer' as const },
          patient: {},
          suspectProducts: [],
          adverseEvents: [],
        },
      }
      await expect(service.create(actor, dto, {})).rejects.toThrow(BadRequestException)
    })

    it('throws ForbiddenException for an actor with no company', async () => {
      const { service } = buildHarness()
      const platformActor = { ...actor, companyId: null }
      await expect(service.create(platformActor, baseCallDto, {})).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('VigiCloud Stage 21 — logs a voicemail with an encrypted transcription note, returned decrypted, ciphertext never in the response', async () => {
      const { service, tables } = buildHarness()

      const result = await service.create(
        actor,
        {
          ...baseCallDto,
          isVoicemail: true,
          audioDocumentId: 'doc-1',
          transcriptionNote: 'Caller reported a rash after taking Panadol.',
        },
        {},
      )

      expect(tables.callLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isVoicemail: true,
            audioDocumentId: 'doc-1',
            transcriptionNoteEncrypted: 'enc(Caller reported a rash after taking Panadol.)',
          }),
        }),
      )
      expect(result.transcriptionNote).toBe('Caller reported a rash after taking Panadol.')
      expect(
        (result as unknown as Record<string, unknown>).transcriptionNoteEncrypted,
      ).toBeUndefined()
    })

    it('computes isAfterHours live from occurredAt — true outside business hours', async () => {
      const { service } = buildHarness()
      const result = await service.create(
        actor,
        { ...baseCallDto, occurredAt: '2026-08-08T20:00:00.000Z', isVoicemail: true },
        {},
      ) // Saturday evening
      expect(result.isAfterHours).toBe(true)
    })

    it('computes isAfterHours as false for a weekday within business hours', async () => {
      const { service } = buildHarness()
      const result = await service.create(
        actor,
        { ...baseCallDto, occurredAt: '2026-08-12T10:00:00.000Z' },
        {},
      ) // Wednesday 10am
      expect(result.isAfterHours).toBe(false)
    })

    it('defaults isVoicemail to false and leaves audio/transcription fields null when not a voicemail', async () => {
      const { service, tables } = buildHarness()
      await service.create(actor, baseCallDto, {})
      expect(tables.callLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isVoicemail: false,
            audioDocumentId: null,
            transcriptionNoteEncrypted: null,
          }),
        }),
      )
    })

    it('404s when audioDocumentId does not belong to this company', async () => {
      const { service } = buildHarness([])
      await expect(
        service.create(
          actor,
          { ...baseCallDto, isVoicemail: true, audioDocumentId: 'doc-missing' },
          {},
        ),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('list()', () => {
    it("scopes the query to the actor's own company", async () => {
      const { service, tables } = buildHarness()
      await service.list(actor, { page: 1, limit: 25 })

      expect(tables.callLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ companyId: 'company-1' }) }),
      )
    })

    it('applies a case-insensitive caller-number search filter', async () => {
      const { service, tables } = buildHarness()
      await service.list(actor, { page: 1, limit: 25, search: '0700' })

      expect(tables.callLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            callerNumber: { contains: '0700', mode: 'insensitive' },
          }),
        }),
      )
    })

    it("decrypts each row's transcription note and never leaks the ciphertext field", async () => {
      const { service } = buildHarness()
      await service.create(
        actor,
        { ...baseCallDto, isVoicemail: true, transcriptionNote: 'A real voicemail summary' },
        {},
      )

      const page = await service.list(actor, { page: 1, limit: 25 })
      expect(page.data[0].transcriptionNote).toBe('A real voicemail summary')
      expect(
        (page.data[0] as unknown as Record<string, unknown>).transcriptionNoteEncrypted,
      ).toBeUndefined()
    })
  })
})
