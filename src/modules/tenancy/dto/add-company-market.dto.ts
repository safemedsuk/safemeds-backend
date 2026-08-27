import { IsUUID } from 'class-validator'

export class AddCompanyMarketDto {
  @IsUUID()
  countryId!: string
}
