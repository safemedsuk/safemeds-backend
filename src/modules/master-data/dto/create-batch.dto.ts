import { IsDateString, IsString, IsUUID } from 'class-validator'

export class CreateBatchDto {
  @IsUUID()
  productId!: string

  @IsString()
  batchNumber!: string

  @IsDateString()
  manufacturedOn!: string

  @IsDateString()
  expiresOn!: string
}
