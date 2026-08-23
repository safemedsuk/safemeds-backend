import { IsOptional, IsString, IsUUID } from 'class-validator'

export class CreatePromotionalMaterialSubmissionDto {
  @IsUUID()
  productId!: string

  @IsUUID()
  authorityId!: string

  /** Plain string — `print | digital | broadcast`. */
  @IsString()
  materialType!: string

  /** Optional at create time — a draft can be started before the artifact itself is uploaded; `PromotionalMaterialWorkflowGuards` blocks `draft → submitted` until this (or a later `attachMaterialDocument()` call) sets it. */
  @IsOptional()
  @IsUUID()
  materialDocumentId?: string
}
