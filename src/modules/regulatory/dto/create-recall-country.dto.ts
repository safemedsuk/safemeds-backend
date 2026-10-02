import { IsOptional, IsUUID } from 'class-validator'

export class CreateRecallCountryDto {
  @IsUUID()
  countryId!: string

  @IsOptional()
  @IsUUID()
  regulatoryAuthorityId?: string
}
