import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export const SUPPLIER_APPROVAL_STATUS_VALUES = [
  'pending',
  'approved',
  'suspended',
  'disqualified',
] as const

/**
 * QualCloud (Phase 13) Stage 11 — `approvalStatus` deliberately removed
 * from this plain-field DTO. Before this stage, a tenant could silently
 * bypass the real qualification lifecycle (`SupplierQualificationService
 * .approve()` — the sign-off action that also computes a live
 * `nextRequalificationDueAt`) by just PATCHing this field directly, which
 * would have left `nextRequalificationDueAt`/`lastQualifiedAt` stale
 * the moment a supplier was marked `approved` through this older
 * endpoint. The only way to change `approvalStatus` now is
 * `POST /quality/supplier-qualification/:id/approve`
 * (`quality.approve_suppliers`) — a real, narrower permission than this
 * endpoint's own `quality.manage_suppliers`, matching the sign-off/
 * drafting split this project already established for recalls/CAPAs.
 */
export class UpdateSupplierDto {
  @IsOptional()
  @MinLength(1)
  @MaxLength(200)
  @IsString()
  name?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  supplierType?: string

  @IsOptional()
  @IsUUID()
  countryId?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string

  @IsOptional()
  @IsIn(['critical', 'non_critical'])
  criticality?: string

  @IsOptional()
  @IsUUID()
  manufacturerId?: string
}
