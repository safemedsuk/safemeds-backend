import { Injectable } from '@nestjs/common'

import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface'
import { RiskManagementPlanService } from '../../reporting/risk-management-plan.service'
import { Importer, ImporterColumn, RequestMeta } from './importer.interface'

/**
 * Real-usage request, 22 Sep 2026 (item 8) — "for a client with many
 * products, allow uploading/bulk-importing RMP data." Matches products
 * by their own brand name (see `RiskManagementPlanService
 * .findProductByBrandName()`'s own doc comment for the real limitation
 * there — no schema-level uniqueness on `brandName`) rather than
 * creating products, since an RMP always belongs to an
 * already-cataloged product. Each successful row creates one new
 * **draft** RMP version (`RiskManagementPlanService.create()`,
 * version-on-write, exactly like a single manual "New RMP" action) —
 * this importer never activates a version; that remains a deliberate,
 * individually-reviewed action per RMP, matching the clinical-trial
 * importer's own "bulk import creates the record, a human still does
 * the sensitive part" precedent.
 */
@Injectable()
export class RmpImporter implements Importer {
  readonly importType = 'risk_management_plan'
  readonly label = 'Bulk import Risk Management Plans'
  readonly requiredPermission = 'rmp.manage'
  readonly columns: ImporterColumn[] = [
    {
      key: 'productBrandName',
      label: 'Product Brand Name',
      required: true,
      aliases: ['Product', 'Brand Name', 'Product Name'],
    },
    { key: 'title', label: 'RMP Title', required: true, aliases: ['Title'] },
    { key: 'summary', label: 'Summary', required: false },
    {
      key: 'nextRenewalDueAt',
      label: 'Next Renewal Due',
      required: false,
      aliases: ['Renewal Date', 'Next Renewal', 'Due Date'],
    },
  ]

  constructor(private readonly riskManagementPlanService: RiskManagementPlanService) {}

  validateRow(row: Record<string, string>): string[] {
    const errors: string[] = []

    if (!row.productBrandName?.trim()) errors.push('Product Brand Name is required')
    if (!row.title?.trim()) errors.push('RMP Title is required')

    if (row.nextRenewalDueAt?.trim() && Number.isNaN(Date.parse(row.nextRenewalDueAt))) {
      errors.push(`Next Renewal Due "${row.nextRenewalDueAt}" is not a valid date`)
    }

    return errors
  }

  async commitRow(
    actor: AuthenticatedUser,
    row: Record<string, string>,
    meta: RequestMeta,
  ): Promise<void> {
    const product = await this.riskManagementPlanService.findProductByBrandName(
      actor,
      row.productBrandName.trim(),
    )
    if (!product) {
      throw new Error(`No active product found with brand name "${row.productBrandName.trim()}"`)
    }

    await this.riskManagementPlanService.create(
      actor,
      {
        productId: product.id,
        title: row.title.trim(),
        summary: row.summary?.trim() || undefined,
        nextRenewalDueAt: row.nextRenewalDueAt?.trim()
          ? new Date(row.nextRenewalDueAt).toISOString()
          : undefined,
      },
      meta,
    )
  }
}
