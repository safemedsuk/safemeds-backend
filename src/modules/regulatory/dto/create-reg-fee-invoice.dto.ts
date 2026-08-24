import { IsDateString, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator'

export class CreateRegFeeInvoiceDto {
  @IsOptional()
  @IsUUID()
  productRegistrationId?: string

  @IsOptional()
  @IsUUID()
  regDossierId?: string

  @IsString()
  feeType!: string

  @IsNumberString()
  amount!: string

  @IsOptional()
  @IsString()
  currency?: string

  @IsDateString()
  dueAt!: string

  @IsOptional()
  @IsString()
  description?: string
}
