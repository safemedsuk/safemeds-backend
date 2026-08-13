import { Injectable } from '@nestjs/common'

import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface'
import {
  PRODUCT_CATEGORY_LABELS,
  resolveProductCategory,
} from '../../../common/product-category.const'
import { MasterDataService } from '../../master-data/master-data.service'
import { Importer, ImporterColumn, RequestMeta } from './importer.interface'

/** A single row's "10s blister;30s bottle" split into tokens — semicolon, matching `user_invite`'s multi-value-cell convention (a comma is what separates CSV *columns*). */
function splitTokens(raw: string): string[] {
  return raw
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean)
}

/**
 * VigiCloud Stage 2 — bulk-importing a company's product catalog. The
 * exact scenario the todo doc's own Stage 2 planning calls out:
 * *"Onboard of a new client should provide product list per country"* —
 * a new tenant with dozens or hundreds of products shouldn't have to use
 * "Add Product" one row at a time. Reuses `MasterDataService.createProduct()`
 * row-by-row, same shape as `UserInviteImporter` reusing
 * `InvitationsService.create()` — no duplicated validation logic.
 */
@Injectable()
export class ProductImporter implements Importer {
  readonly importType = 'product'
  readonly label = 'Bulk import products'
  readonly requiredPermission = 'master_data.manage'
  readonly columns: ImporterColumn[] = [
    {
      key: 'brandName',
      label: 'Brand Name',
      required: true,
      aliases: ['Brand', 'Product Name', 'Product'],
    },
    {
      key: 'genericName',
      label: 'Generic Name',
      required: true,
      aliases: ['Generic', 'Generic/INN Name'],
    },
    {
      key: 'productCategory',
      label: 'Category',
      required: true,
      aliases: ['Product Category', 'Type'],
    },
    { key: 'dosageForm', label: 'Dosage Form', required: true, aliases: ['Form', 'Dosage'] },
    { key: 'strength', label: 'Strength', required: true, aliases: ['Dose Strength'] },
    {
      key: 'innName',
      label: 'INN Name',
      required: false,
      aliases: ['INN', 'International Nonproprietary Name'],
    },
    { key: 'atcCode', label: 'ATC Code', required: false, aliases: ['ATC'] },
    { key: 'formulation', label: 'Formulation', required: false, aliases: ['Release Profile'] },
    {
      key: 'routeOfAdministration',
      label: 'Route',
      required: false,
      aliases: ['Route of Administration'],
    },
    {
      key: 'siteOfManufacture',
      label: 'Site of Manufacture',
      required: false,
      aliases: ['Manufacturing Site', 'Site'],
    },
    {
      key: 'packSizes',
      label: 'Pack Size(s)',
      required: false,
      aliases: ['Pack Sizes', 'Pack Size', 'Packaging'],
    },
  ]

  constructor(private readonly masterDataService: MasterDataService) {}

  validateRow(row: Record<string, string>): string[] {
    const errors: string[] = []

    if (!row.brandName?.trim()) errors.push('Brand Name is required')
    if (!row.genericName?.trim()) errors.push('Generic Name is required')
    if (!row.dosageForm?.trim()) errors.push('Dosage Form is required')
    if (!row.strength?.trim()) errors.push('Strength is required')

    if (!row.productCategory?.trim()) {
      errors.push(
        `Category is required — valid categories are: ${this.validCategoryNamesForDisplay()}`,
      )
    } else if (resolveProductCategory(row.productCategory) === null) {
      errors.push(
        `Unrecognized category "${row.productCategory}" — valid categories are: ${this.validCategoryNamesForDisplay()}`,
      )
    }

    return errors
  }

  async commitRow(
    actor: AuthenticatedUser,
    row: Record<string, string>,
    meta: RequestMeta,
  ): Promise<void> {
    const productCategory = resolveProductCategory(row.productCategory)!

    await this.masterDataService.createProduct(
      actor,
      {
        brandName: row.brandName.trim(),
        genericName: row.genericName.trim(),
        productCategory,
        dosageForm: row.dosageForm.trim(),
        strength: row.strength.trim(),
        innName: row.innName?.trim() || undefined,
        atcCode: row.atcCode?.trim() || undefined,
        formulation: row.formulation?.trim() || undefined,
        routeOfAdministration: row.routeOfAdministration?.trim() || undefined,
        siteOfManufacture: row.siteOfManufacture?.trim() || undefined,
        packSizes: row.packSizes ? splitTokens(row.packSizes) : undefined,
      },
      meta,
    )
  }

  private validCategoryNamesForDisplay(): string {
    return Object.values(PRODUCT_CATEGORY_LABELS).join(', ')
  }
}
