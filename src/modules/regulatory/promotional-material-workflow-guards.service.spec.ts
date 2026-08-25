import { TransitionGuardFn } from '../workflow/workflow-guard-registry.service'
import { StatusSyncFn } from '../workflow/workflow-status-sync-registry.service'
import { PROMOTIONAL_MATERIAL_RECORD_TYPE } from './promotional-material-submission.service'
import { PromotionalMaterialWorkflowGuards } from './promotional-material-workflow-guards.service'

function buildHarness() {
  const guardRegister = jest.fn()
  const guardRegistry = { register: guardRegister } as never

  const statusSyncRegister = jest.fn()
  const statusSyncRegistry = { register: statusSyncRegister } as never

  new PromotionalMaterialWorkflowGuards(guardRegistry, statusSyncRegistry).onModuleInit()

  return { guardRegister, statusSyncRegister }
}

describe('PromotionalMaterialWorkflowGuards', () => {
  it('registers exactly one guard, on the draft state', () => {
    const { guardRegister } = buildHarness()
    expect(guardRegister).toHaveBeenCalledTimes(1)
    expect(guardRegister).toHaveBeenCalledWith(
      PROMOTIONAL_MATERIAL_RECORD_TYPE,
      'draft',
      expect.any(Function),
    )
  })

  it('registers a status-sync function', () => {
    const { statusSyncRegister } = buildHarness()
    expect(statusSyncRegister).toHaveBeenCalledWith(
      PROMOTIONAL_MATERIAL_RECORD_TYPE,
      expect.any(Function),
    )
  })

  describe('material-document completeness gate', () => {
    it('ignores a toStateKey other than submitted', async () => {
      const { guardRegister } = buildHarness()
      const guard = guardRegister.mock.calls[0][2] as TransitionGuardFn

      const result = await guard({
        tx: {} as never,
        companyId: 'company-1',
        recordId: 'submission-1',
        toStateKey: 'somewhere_else',
        actorUserId: 'user-1',
      })
      expect(result).toEqual({ allowed: true })
    })

    it('disallows submitting when no material document is attached', async () => {
      const { guardRegister } = buildHarness()
      const guard = guardRegister.mock.calls[0][2] as TransitionGuardFn
      const findUniqueOrThrow = jest
        .fn()
        .mockResolvedValue({ id: 'submission-1', materialDocumentId: null })
      const tx = { promotionalMaterialSubmission: { findUniqueOrThrow } } as never

      const result = await guard({
        tx,
        companyId: 'company-1',
        recordId: 'submission-1',
        toStateKey: 'submitted',
        actorUserId: 'user-1',
      })
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/attach the promotional material/i)
    })

    it('allows submitting once a material document is attached', async () => {
      const { guardRegister } = buildHarness()
      const guard = guardRegister.mock.calls[0][2] as TransitionGuardFn
      const findUniqueOrThrow = jest
        .fn()
        .mockResolvedValue({ id: 'submission-1', materialDocumentId: 'doc-1' })
      const tx = { promotionalMaterialSubmission: { findUniqueOrThrow } } as never

      const result = await guard({
        tx,
        companyId: 'company-1',
        recordId: 'submission-1',
        toStateKey: 'submitted',
        actorUserId: 'user-1',
      })
      expect(result).toEqual({ allowed: true })
    })
  })

  describe('status sync', () => {
    it('keeps PromotionalMaterialSubmission.status in sync with every transition', async () => {
      const { statusSyncRegister } = buildHarness()
      const sync = statusSyncRegister.mock.calls[0][1] as StatusSyncFn
      const update = jest.fn().mockResolvedValue({})
      const tx = { promotionalMaterialSubmission: { update } } as never

      await sync({
        tx,
        companyId: 'company-1',
        recordId: 'submission-1',
        toStateKey: 'approved',
        actorUserId: 'user-1',
      })
      expect(update).toHaveBeenCalledWith({
        where: { id: 'submission-1' },
        data: { status: 'approved' },
      })
    })
  })
})
