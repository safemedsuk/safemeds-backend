import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CodingService } from './coding.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const adverseEvent = { id: 'ae-1', caseId: 'case-1', companyId: 'company-1', meddraTermId: null }
  const suspectProduct = {
    id: 'sp-1',
    caseId: 'case-1',
    companyId: 'company-1',
    whoDrugTermId: null,
  }
  const meddraTerm = { id: 'term-1', code: 'MOCK-000042', level: 'LLT', name: 'Itchy rash' }
  const whoDrugTerm = { id: 'drug-1', drugRecordNumber: 'MOCK-DRN-000007', name: 'Panadol' }

  const adverseEventFindFirst = jest.fn().mockResolvedValue(adverseEvent)
  const adverseEventUpdate = jest
    .fn()
    .mockImplementation(({ data }) => Promise.resolve({ ...adverseEvent, ...data }))
  const meddraTermFindUnique = jest.fn().mockResolvedValue(meddraTerm)

  const suspectProductFindFirst = jest.fn().mockResolvedValue(suspectProduct)
  const suspectProductUpdate = jest
    .fn()
    .mockImplementation(({ data }) => Promise.resolve({ ...suspectProduct, ...data }))
  const whoDrugTermFindUnique = jest.fn().mockResolvedValue(whoDrugTerm)

  const tables = {
    adverseEvent: { findFirst: adverseEventFindFirst, update: adverseEventUpdate },
    meddraTerm: { findUnique: meddraTermFindUnique },
    suspectProduct: { findFirst: suspectProductFindFirst, update: suspectProductUpdate },
    whoDrugTerm: { findUnique: whoDrugTermFindUnique },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new CodingService(rls as never, auditService)
  return {
    service,
    tables,
    auditLog,
    adverseEventFindFirst,
    adverseEventUpdate,
    meddraTermFindUnique,
    suspectProductFindFirst,
    suspectProductUpdate,
    whoDrugTermFindUnique,
  }
}

describe('CodingService', () => {
  describe('codeAdverseEvent()', () => {
    it('assigns the MedDRA term and stamps who/when', async () => {
      const { service, adverseEventUpdate } = buildHarness()

      const result = await service.codeAdverseEvent(
        actor,
        'case-1',
        'ae-1',
        { meddraTermId: 'term-1' },
        {},
      )

      expect(adverseEventUpdate).toHaveBeenCalledWith({
        where: { id: 'ae-1' },
        data: { meddraTermId: 'term-1', meddraCodedBy: 'user-1', meddraCodedAt: expect.any(Date) },
      })
      expect(result.meddraTermId).toBe('term-1')
    })

    it('audits the coding with the old and new term id', async () => {
      const { service, auditLog } = buildHarness()
      await service.codeAdverseEvent(actor, 'case-1', 'ae-1', { meddraTermId: 'term-1' }, {})

      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'pv_adverse_event_coded',
          oldValue: { adverseEventId: 'ae-1', meddraTermId: null },
          newValue: expect.objectContaining({ adverseEventId: 'ae-1', meddraTermId: 'term-1' }),
        }),
      )
    })

    it('404s when the adverse event does not belong to this case/company', async () => {
      const { service, adverseEventFindFirst } = buildHarness()
      adverseEventFindFirst.mockResolvedValue(null)
      await expect(
        service.codeAdverseEvent(actor, 'case-1', 'missing-ae', { meddraTermId: 'term-1' }, {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('404s when the MedDRA term id does not exist', async () => {
      const { service, meddraTermFindUnique } = buildHarness()
      meddraTermFindUnique.mockResolvedValue(null)
      await expect(
        service.codeAdverseEvent(actor, 'case-1', 'ae-1', { meddraTermId: 'nonexistent' }, {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      const platformActor = { ...actor, companyId: null }
      await expect(
        service.codeAdverseEvent(platformActor, 'case-1', 'ae-1', { meddraTermId: 'term-1' }, {}),
      ).rejects.toThrow(ForbiddenException)
    })

    it('re-coding to a different term overwrites the old value and audits the transition', async () => {
      const { service, tables, auditLog } = buildHarness()
      tables.adverseEvent.findFirst = jest
        .fn()
        .mockResolvedValue({
          id: 'ae-1',
          caseId: 'case-1',
          companyId: 'company-1',
          meddraTermId: 'old-term',
        })

      await service.codeAdverseEvent(actor, 'case-1', 'ae-1', { meddraTermId: 'term-1' }, {})

      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ oldValue: { adverseEventId: 'ae-1', meddraTermId: 'old-term' } }),
      )
    })
  })

  describe('codeSuspectProduct()', () => {
    it('assigns the WHODrug term and stamps who/when', async () => {
      const { service, suspectProductUpdate } = buildHarness()

      const result = await service.codeSuspectProduct(
        actor,
        'case-1',
        'sp-1',
        { whoDrugTermId: 'drug-1' },
        {},
      )

      expect(suspectProductUpdate).toHaveBeenCalledWith({
        where: { id: 'sp-1' },
        data: {
          whoDrugTermId: 'drug-1',
          whoDrugCodedBy: 'user-1',
          whoDrugCodedAt: expect.any(Date),
        },
      })
      expect(result.whoDrugTermId).toBe('drug-1')
    })

    it('audits the coding', async () => {
      const { service, auditLog } = buildHarness()
      await service.codeSuspectProduct(actor, 'case-1', 'sp-1', { whoDrugTermId: 'drug-1' }, {})

      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'pv_suspect_product_coded' }),
      )
    })

    it('404s when the suspect product does not belong to this case/company', async () => {
      const { service, suspectProductFindFirst } = buildHarness()
      suspectProductFindFirst.mockResolvedValue(null)
      await expect(
        service.codeSuspectProduct(actor, 'case-1', 'missing-sp', { whoDrugTermId: 'drug-1' }, {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('404s when the WHODrug term id does not exist', async () => {
      const { service, whoDrugTermFindUnique } = buildHarness()
      whoDrugTermFindUnique.mockResolvedValue(null)
      await expect(
        service.codeSuspectProduct(actor, 'case-1', 'sp-1', { whoDrugTermId: 'nonexistent' }, {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      const platformActor = { ...actor, companyId: null }
      await expect(
        service.codeSuspectProduct(
          platformActor,
          'case-1',
          'sp-1',
          { whoDrugTermId: 'drug-1' },
          {},
        ),
      ).rejects.toThrow(ForbiddenException)
    })
  })
})
