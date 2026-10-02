import { RegVariationType } from '@prisma/client'
import { IsEnum, IsOptional, IsUUID } from 'class-validator'

export class OpenLinkedVariationDto {
  /** Overrides the change control's own `affectedProductRegistrationId`, if it wasn't set at creation. */
  @IsOptional()
  @IsUUID()
  productRegistrationId?: string

  /** Overrides the default `changeType`-derived mapping (`like_for_like`/`minor` → `minor`, `major`/`critical` → `major`). */
  @IsOptional()
  @IsEnum(RegVariationType)
  variationType?: RegVariationType
}
