import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ExpectednessService } from './expectedness.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const pvCase = { id: 'case-1', companyId: 'company-1', expectednessFlag: 'not_assessed' as const }

  const caseFindFirst = jest.fn().mockResolvedValue(pvCase)
  const caseUpdate = jest
    .fn()
    .mockImplementation(({ data }) => Promise.resolve({ ...pvCase, ...data }))
  const tables = { case: { findFirst: caseFindFirst, update: caseUpdate } }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const encrypt = jest.fn((plaintext: string) => `enc(${plaintext})`)
  const textEncryption = { encrypt } as never

  const service = new ExpectednessService(rls as never, auditService, textEncryption)
  return { service, tables, auditLog, encrypt, caseFindFirst, caseUpdate }
}

describe('ExpectednessService', () => {
  describe('assess()', () => {
    it('sets the flag and encrypts the note', async () => {
      const { service, caseUpdate, encrypt } = buildHarness()

      const result = await service.assess(
        actor,
        'case-1',
        { expectednessFlag: 'unlisted', note: 'Not in the current SmPC' },
        {},
      )

      expect(encrypt).toHaveBeenCalledWith('Not in the current SmPC')
      expect(caseUpdate).toHaveBeenCalledWith({
        where: { id: 'case-1' },
        data: {
          expectednessFlag: 'unlisted',
          expectednessNoteEncrypted: 'enc(Not in the current SmPC)',
          expectednessAssessedBy: 'user-1',
          expectednessAssessedAt: expect.any(Date),
        },
      })
      expect(result.expectednessFlag).toBe('unlisted')
    })

    it('stores a null note when none is given, without calling encrypt', async () => {
      const { service, caseUpdate, encrypt } = buildHarness()

      await service.assess(actor, 'case-1', { expectednessFlag: 'listed' }, {})

      expect(encrypt).not.toHaveBeenCalled()
      expect(caseUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ expectednessNoteEncrypted: null }),
        }),
      )
    })

    it('audits old and new flag values', async () => {
      const { service, auditLog } = buildHarness()
      await service.assess(actor, 'case-1', { expectednessFlag: 'listed' }, {})

      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'pv_case_expectedness_assessed',
          oldValue: { expectednessFlag: 'not_assessed' },
          newValue: { expectednessFlag: 'listed' },
        }),
      )
    })

    it('is callable more than once — reassessment is the normal path, not an edge case', async () => {
      const { service, tables } = buildHarness()
      await service.assess(actor, 'case-1', { expectednessFlag: 'listed' }, {})
      tables.case.findFirst = jest
        .fn()
        .mockResolvedValue({ id: 'case-1', companyId: 'company-1', expectednessFlag: 'listed' })

      const result = await service.assess(
        actor,
        'case-1',
        { expectednessFlag: 'unlisted', note: 'Label updated' },
        {},
      )
      expect(result.expectednessFlag).toBe('unlisted')
    })

    it('404s for a case that does not exist in this company', async () => {
      const { service, caseFindFirst } = buildHarness()
      caseFindFirst.mockResolvedValue(null)
      await expect(
        service.assess(actor, 'missing-case', { expectednessFlag: 'listed' }, {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      const platformActor = { ...actor, companyId: null }
      await expect(
        service.assess(platformActor, 'case-1', { expectednessFlag: 'listed' }, {}),
      ).rejects.toThrow(ForbiddenException)
    })
  })
})
