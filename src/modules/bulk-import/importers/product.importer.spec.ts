import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface'
import { ProductImporter } from './product.importer'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['SYSTEM_ADMINISTRATOR'],
  platformRole: null,
  tokenVersion: 1,
}

function buildImporter() {
  const createProduct = jest.fn().mockResolvedValue(undefined)
  const masterDataService = { createProduct } as never
  return { importer: new ProductImporter(masterDataService), createProduct }
}

const baseRow = {
  brandName: 'Amoxiclav',
  genericName: 'Amoxicillin/Clavulanate',
  productCategory: 'Medicinal',
  dosageForm: 'Tablet',
  strength: '500mg/125mg',
}

describe('ProductImporter', () => {
  describe('validateRow()', () => {
    it('accepts a valid row using the friendly category label', () => {
      const { importer } = buildImporter()
      expect(importer.validateRow(baseRow)).toEqual([])
    })

    it('accepts a valid row using the raw category key, any case', () => {
      const { importer } = buildImporter()
      expect(importer.validateRow({ ...baseRow, productCategory: 'MEDICINAL' })).toEqual([])
    })

    it('rejects a missing brand name', () => {
      const { importer } = buildImporter()
      const errors = importer.validateRow({ ...baseRow, brandName: '' })
      expect(errors).toContain('Brand Name is required')
    })

    it('rejects a missing generic name', () => {
      const { importer } = buildImporter()
      const errors = importer.validateRow({ ...baseRow, genericName: '' })
      expect(errors).toContain('Generic Name is required')
    })

    it('rejects a missing dosage form', () => {
      const { importer } = buildImporter()
      const errors = importer.validateRow({ ...baseRow, dosageForm: '' })
      expect(errors).toContain('Dosage Form is required')
    })

    it('rejects a missing strength', () => {
      const { importer } = buildImporter()
      const errors = importer.validateRow({ ...baseRow, strength: '' })
      expect(errors).toContain('Strength is required')
    })

    it('rejects a missing category and lists the valid category names', () => {
      const { importer } = buildImporter()
      const errors = importer.validateRow({ ...baseRow, productCategory: '' })
      expect(errors.some((e) => e.includes('Category is required'))).toBe(true)
      expect(errors.some((e) => e.includes('Medical Device / IVD'))).toBe(true)
    })

    it('rejects an unrecognized category, names it, and lists the valid category names', () => {
      const { importer } = buildImporter()
      const errors = importer.validateRow({ ...baseRow, productCategory: 'Not A Real Category' })
      expect(errors.some((e) => e.includes('Not A Real Category'))).toBe(true)
      expect(errors.some((e) => e.includes('Blood Product'))).toBe(true)
    })
  })

  describe('commitRow()', () => {
    it('resolves the friendly category label to its canonical key and delegates to MasterDataService.createProduct()', async () => {
      const { importer, createProduct } = buildImporter()
      await importer.commitRow(actor, baseRow, {})

      expect(createProduct).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          brandName: 'Amoxiclav',
          genericName: 'Amoxicillin/Clavulanate',
          productCategory: 'medicinal',
          dosageForm: 'Tablet',
          strength: '500mg/125mg',
        }),
        {},
      )
    })

    it('parses semicolon-separated pack sizes into an array', async () => {
      const { importer, createProduct } = buildImporter()
      await importer.commitRow(actor, { ...baseRow, packSizes: '10s blister; 30s bottle ' }, {})

      expect(createProduct).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({ packSizes: ['10s blister', '30s bottle'] }),
        {},
      )
    })

    it('omits optional fields entirely when the row leaves them blank, rather than passing empty strings', async () => {
      const { importer, createProduct } = buildImporter()
      await importer.commitRow(actor, baseRow, {})

      const [, dto] = createProduct.mock.calls[0]
      expect(dto.innName).toBeUndefined()
      expect(dto.atcCode).toBeUndefined()
      expect(dto.packSizes).toBeUndefined()
    })

    it('passes through the PV-mandatory optional fields when present', async () => {
      const { importer, createProduct } = buildImporter()
      await importer.commitRow(
        actor,
        {
          ...baseRow,
          innName: 'Amoxicillin',
          atcCode: 'J01CR02',
          formulation: 'immediate release',
          routeOfAdministration: 'Oral',
          siteOfManufacture: 'Nairobi',
        },
        {},
      )

      expect(createProduct).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          innName: 'Amoxicillin',
          atcCode: 'J01CR02',
          formulation: 'immediate release',
          routeOfAdministration: 'Oral',
          siteOfManufacture: 'Nairobi',
        }),
        {},
      )
    })
  })

  describe('columns', () => {
    it("declares header aliases so a real spreadsheet's own column naming is accepted", () => {
      const { importer } = buildImporter()
      const brandColumn = importer.columns.find((c) => c.key === 'brandName')!
      const categoryColumn = importer.columns.find((c) => c.key === 'productCategory')!
      expect(brandColumn.aliases).toContain('Product Name')
      expect(categoryColumn.aliases).toContain('Type')
    })
  })

  describe('requiredPermission', () => {
    it('requires master_data.manage, not users.invite', () => {
      const { importer } = buildImporter()
      expect(importer.requiredPermission).toBe('master_data.manage')
    })
  })
})
