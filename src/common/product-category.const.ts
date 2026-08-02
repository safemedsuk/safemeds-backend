import { ProductCategory } from '@prisma/client'

/**
 * Human-facing labels for `ProductCategory`, in the same spirit as
 * `tenant-roles.const.ts`'s `TENANT_ROLE_LABELS` — a business user
 * preparing a bulk-import spreadsheet (Stage 2's `product` importer)
 * should never need to know the raw enum key (`device_ivd`) when a
 * plain label ("Medical Device / IVD") is what they'd actually type.
 */
export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  medicinal: 'Medicinal',
  blood_product: 'Blood Product',
  herbal: 'Herbal',
  cosmeceutical: 'Cosmeceutical',
  vaccine: 'Vaccine',
  device_ivd: 'Medical Device / IVD',
  other: 'Other',
}

const PRODUCT_CATEGORY_KEYS = Object.keys(PRODUCT_CATEGORY_LABELS) as ProductCategory[]

/**
 * Resolves free-text category input to a canonical `ProductCategory`,
 * accepting either the raw key (`"device_ivd"`, any case) or the human
 * label (`"Medical Device / IVD"`, any case). Returns `null` for
 * anything that matches neither, rather than guessing.
 */
export function resolveProductCategory(input: string): ProductCategory | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const lowerKey = trimmed.toLowerCase().replace(/[\s/-]+/g, '_') as ProductCategory
  if (PRODUCT_CATEGORY_KEYS.includes(lowerKey)) return lowerKey

  const lower = trimmed.toLowerCase()
  const byLabel = (Object.entries(PRODUCT_CATEGORY_LABELS) as [ProductCategory, string][]).find(
    ([, label]) => label.toLowerCase() === lower,
  )
  return byLabel ? byLabel[0] : null
}
