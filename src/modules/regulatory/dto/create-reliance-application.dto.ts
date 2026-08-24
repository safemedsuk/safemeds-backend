import { ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayUnique, IsArray, IsOptional, IsString, IsUUID } from 'class-validator'

export class CreateRelianceApplicationDto {
  @IsUUID()
  productId!: string

  /** Plain string — `eac_joint_assessment | zaziboNa | who_crp`. */
  @IsString()
  pathwayType!: string

  @IsUUID()
  leadAuthorityId!: string

  /** The relying markets this reliance pathway is pursued in, alongside the lead/reference authority above — optional at creation, can be added later via `addParticipatingAuthority()`. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  participatingAuthorityIds?: string[]

  /** Passed straight through to the lead dossier's own `RegDossierService.create()` call. */
  @IsString()
  productClass!: string

  @IsOptional()
  @IsString()
  route?: string
}
