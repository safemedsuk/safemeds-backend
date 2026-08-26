import { TransitionGuardFn } from '../workflow/workflow-guard-registry.service'
import { REG_REGISTRATION_RECORD_TYPE } from './reg-dossier.service'
import { RegEngagementModelGuards } from './reg-engagement-model-guards.service'

function buildHarness() {
  const register = jest.fn()
  const guardRegistry = { register } as never

  const resolveEffective = jest.fn()
  const engagementModelService = { resolveEffective } as never

  new RegEngagementModelGuards(guardRegistry, engagementModelService).onModuleInit()

  return { register, resolveEffective }
}

const baseCtx = {
  tx: {} as never,
  companyId: 'company-1',
  recordId: 'dossier-1',
  actorUserId: 'user-1',
}

describe('RegEngagementModelGuards', () => {
  it('registers exactly 2 guards, on completeness_check and responding', () => {
    const { register } = buildHarness()
    expect(register).toHaveBeenCalledTimes(2)
    expect(register).toHaveBeenNthCalledWith(
      1,
      REG_REGISTRATION_RECORD_TYPE,
      'completeness_check',
      expect.any(Function),
    )
    expect(register).toHaveBeenNthCalledWith(
      2,
      REG_REGISTRATION_RECORD_TYPE,
      'responding',
      expect.any(Function),
    )
  })

  describe('dossier_review_only — completeness_check → submitted', () => {
    it('ignores a toStateKey other than submitted', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[0][2] as TransitionGuardFn
      const result = await guard({ ...baseCtx, toStateKey: 'somewhere_else' })
      expect(result).toEqual({ allowed: true })
    })

    it('allows through for a full_service dossier with no note', async () => {
      const { register, resolveEffective } = buildHarness()
      resolveEffective.mockResolvedValue('full_service')
      const guard = register.mock.calls[0][2] as TransitionGuardFn

      const result = await guard({ ...baseCtx, toStateKey: 'submitted' })
      expect(result).toEqual({ allowed: true })
    })

    it('disallows a dossier_review_only dossier with no note', async () => {
      const { register, resolveEffective } = buildHarness()
      resolveEffective.mockResolvedValue('dossier_review_only')
      const guard = register.mock.calls[0][2] as TransitionGuardFn

      const result = await guard({ ...baseCtx, toStateKey: 'submitted' })
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/dossier review only/i)
    })

    it('allows a dossier_review_only dossier once a note is given', async () => {
      const { register, resolveEffective } = buildHarness()
      resolveEffective.mockResolvedValue('dossier_review_only')
      const guard = register.mock.calls[0][2] as TransitionGuardFn

      const result = await guard({
        ...baseCtx,
        toStateKey: 'submitted',
        note: 'The client dispatched this directly on 23 Aug.',
      })
      expect(result).toEqual({ allowed: true })
    })
  })

  describe('client_handles_queries — responding → resubmitted_for_review', () => {
    it('ignores a toStateKey other than resubmitted_for_review', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[1][2] as TransitionGuardFn
      const result = await guard({ ...baseCtx, toStateKey: 'somewhere_else' })
      expect(result).toEqual({ allowed: true })
    })

    it('disallows a client_handles_queries dossier with no note', async () => {
      const { register, resolveEffective } = buildHarness()
      resolveEffective.mockResolvedValue('client_handles_queries')
      const guard = register.mock.calls[1][2] as TransitionGuardFn

      const result = await guard({ ...baseCtx, toStateKey: 'resubmitted_for_review' })
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/client handles queries/i)
    })

    it('allows a client_handles_queries dossier once a note is given', async () => {
      const { register, resolveEffective } = buildHarness()
      resolveEffective.mockResolvedValue('client_handles_queries')
      const guard = register.mock.calls[1][2] as TransitionGuardFn

      const result = await guard({
        ...baseCtx,
        toStateKey: 'resubmitted_for_review',
        note: 'Client resolved directly with the regulator.',
      })
      expect(result).toEqual({ allowed: true })
    })
  })
})
