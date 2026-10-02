import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export const COMPLAINT_CHANNELS = ['phone', 'email', 'written', 'in_person', 'distributor', 'other'] as const

export class CreateComplaintDto {
  @IsUUID()
  productId!: string

  @IsOptional()
  @IsUUID()
  batchId?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reporterName?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reporterContact?: string

  @IsIn(COMPLAINT_CHANNELS)
  channel!: string

  @MinLength(1)
  @MaxLength(4000)
  @IsString()
  description!: string
}

/** Used only by the public, unauthenticated complaint intake endpoint — a plain email in place of arbitrary contact text. */
export class PublicCreateComplaintDto {
  @IsUUID()
  productId!: string

  @IsOptional()
  @IsUUID()
  batchId?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reporterName?: string

  @IsOptional()
  @IsEmail()
  reporterEmail?: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  reporterPhone?: string

  @MinLength(1)
  @MaxLength(4000)
  @IsString()
  description!: string
}
