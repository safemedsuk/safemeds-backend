import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export const SUPPLIER_CRITICALITY_VALUES = ['critical', 'non_critical'] as const

export class CreateSupplierDto {
  @MinLength(1)
  @MaxLength(200)
  @IsString()
  name!: string

  /**
   * Plain string, not a hardcoded enum — see `Supplier.supplierType`'s own
   * schema doc comment. Real, commonly-used values: `api_supplier |
   * excipient_supplier | packaging_supplier | contract_manufacturer |
   * contract_lab | contract_service | other` — not enforced by `IsIn` so a
   * company can record its own type without a migration.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  supplierType!: string

  @IsOptional()
  @IsUUID()
  countryId?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string

  @IsOptional()
  @IsIn(SUPPLIER_CRITICALITY_VALUES)
  criticality?: string

  @IsOptional()
  @IsUUID()
  manufacturerId?: string
}
