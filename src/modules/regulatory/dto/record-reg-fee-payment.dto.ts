import { IsDateString, IsNumberString, IsOptional, IsString } from 'class-validator'

export class RecordRegFeePaymentDto {
  @IsNumberString()
  amount!: string

  @IsDateString()
  paidAt!: string

  @IsOptional()
  @IsString()
  method?: string

  @IsOptional()
  @IsString()
  reference?: string
}
