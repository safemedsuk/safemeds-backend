import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export const STAKEHOLDER_TYPES = [
  'distributor',
  'wholesaler',
  'pharmacy',
  'hospital',
  'clinic',
  'other',
] as const

export class CreateStakeholderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  orgName!: string

  @IsIn(STAKEHOLDER_TYPES)
  type!: (typeof STAKEHOLDER_TYPES)[number]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  country?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  licenceNo?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  licenceStatus?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  parentId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactName?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactPhone?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactWhatsapp?: string
}
