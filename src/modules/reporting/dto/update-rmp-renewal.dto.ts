import { IsDateString } from 'class-validator'

export class UpdateRmpRenewalDto {
  @IsDateString()
  nextRenewalDueAt!: string
}
