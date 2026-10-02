import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface'
import { RmpImporter } from './rmp.importer'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_MANAGER'],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const findProductByBrandName = jest.fn()
  const create = jest.fn().mockResolvedValue({ id: 'rmp-1' })
  const riskManagementPlanService = { findProductByBrandName, create } as never

  const importer = new RmpImporter(riskManagementPlanService)
  return { importer, findProductByBrandName, create }
}

describe('RmpImporter (real-usage request, 22 Sep 2026, item 8)', () => {
  describe('validateRow()', () => {
    it('requires productBrandName and title', () => {
      const { importer } = buildHarness()
      const errors = importer.validateRow({ productBrandName: '', title: '' })
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Product Brand Name'),
          expect.stringContaining('RMP Title'),
        ]),
      )
    })

    it('rejects an unparseable renewal date', () => {
      const { importer } = buildHarness()
      const errors = importer.validateRow({
        productBrandName: 'Amoxil',
        title: 'Amoxil RMP v1',
        nextRenewalDueAt: 'not-a-date',
      })
      expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('not a valid date')]))
    })

    it('accepts a fully valid row', () => {
      const { importer } = buildHarness()
      const errors = importer.validateRow({
        productBrandName: 'Amoxil',
        title: 'Amoxil RMP v1',
        summary: 'Standard risk minimisation measures',
        nextRenewalDueAt: '2027-01-01',
      })
      expect(errors).toEqual([])
    })

    it('accepts a row with the optional columns blank', () => {
      const { importer } = buildHarness()
      const errors = importer.validateRow({ productBrandName: 'Amoxil', title: 'Amoxil RMP v1' })
      expect(errors).toEqual([])
    })
  })

  describe('commitRow()', () => {
    it('resolves the product by brand name and creates a new draft RMP version', async () => {
      const { importer, findProductByBrandName, create } = buildHarness()
      findProductByBrandName.mockResolvedValue({ id: 'product-1' })

      await importer.commitRow(
        actor,
        {
          productBrandName: 'Amoxil',
          title: 'Amoxil RMP v1',
          summary: 'Standard risk minimisation measures',
          nextRenewalDueAt: '2027-01-01',
        },
        {},
      )

      expect(findProductByBrandName).toHaveBeenCalledWith(actor, 'Amoxil')
      expect(create).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          productId: 'product-1',
          title: 'Amoxil RMP v1',
          summary: 'Standard risk minimisation measures',
        }),
        {},
      )
    })

    it('never creates a product itself — only matches an existing one', async () => {
      const { importer, findProductByBrandName, create } = buildHarness()
      findProductByBrandName.mockResolvedValue(null)

      await expect(
        importer.commitRow(actor, { productBrandName: 'Does Not Exist', title: 'X' }, {}),
      ).rejects.toThrow(/No active product found/)
      expect(create).not.toHaveBeenCalled()
    })

    it('omits nextRenewalDueAt when the row leaves it blank', async () => {
      const { importer, findProductByBrandName, create } = buildHarness()
      findProductByBrandName.mockResolvedValue({ id: 'product-1' })

      await importer.commitRow(actor, { productBrandName: 'Amoxil', title: 'Amoxil RMP v1' }, {})

      expect(create).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({ nextRenewalDueAt: undefined }),
        {},
      )
    })
  })
})
