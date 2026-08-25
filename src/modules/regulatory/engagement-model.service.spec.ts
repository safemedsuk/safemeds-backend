import { EngagementModelService } from './engagement-model.service'

function buildTx(
  dossier: { engagementType: string | null } | null,
  company: { engagementType: string },
) {
  const dossierFindUnique = jest.fn().mockResolvedValue(dossier)
  const companyFindUniqueOrThrow = jest.fn().mockResolvedValue(company)
  const tx = {
    regDossier: { findUnique: dossierFindUnique },
    company: { findUniqueOrThrow: companyFindUniqueOrThrow },
  } as never
  return { tx, dossierFindUnique, companyFindUniqueOrThrow }
}

describe('EngagementModelService.resolveEffective', () => {
  it('falls back to the company default when no dossier id is given', async () => {
    const service = new EngagementModelService()
    const { tx } = buildTx(null, { engagementType: 'full_service' })

    const result = await service.resolveEffective(tx, 'company-1')
    expect(result).toBe('full_service')
  })

  it('falls back to the company default when the dossier has no override', async () => {
    const service = new EngagementModelService()
    const { tx } = buildTx({ engagementType: null }, { engagementType: 'dossier_review_only' })

    const result = await service.resolveEffective(tx, 'company-1', 'dossier-1')
    expect(result).toBe('dossier_review_only')
  })

  it("uses the dossier's own override over the company default", async () => {
    const service = new EngagementModelService()
    const { tx, companyFindUniqueOrThrow } = buildTx(
      { engagementType: 'client_handles_queries' },
      { engagementType: 'full_service' },
    )

    const result = await service.resolveEffective(tx, 'company-1', 'dossier-1')
    expect(result).toBe('client_handles_queries')
    expect(companyFindUniqueOrThrow).not.toHaveBeenCalled()
  })
})
