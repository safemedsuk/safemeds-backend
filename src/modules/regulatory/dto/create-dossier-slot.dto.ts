import { IsOptional, IsString } from 'class-validator'

/** An ad-hoc slot — for a document the checklist didn't anticipate. */
export class CreateDossierSlotDto {
  @IsString()
  labelOverride!: string

  @IsOptional()
  @IsString()
  ctdModule?: string
}
