import { CompanyType } from '@prisma/client'
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator'

export class RegisterCompanyDto {
  @IsString()
  @MinLength(2)
  companyName!: string

  @IsEnum(CompanyType)
  companyType!: CompanyType

  @IsUUID('7')
  countryId!: string

  /** testing-correction-explanation.md decision #4 — the company's own official email, carried through to `Company.regulatoryContactEmail` on approval. Deliberately distinct from `adminEmail` — the person registering isn't always the permanent regulatory contact. */
  @IsEmail()
  companyEmail!: string

  @IsString()
  @MinLength(2)
  licenceNumber!: string

  @IsString()
  @MinLength(2)
  adminFullName!: string

  @IsEmail()
  adminEmail!: string

  @IsOptional()
  @IsPhoneNumber()
  adminPhone?: string

  @IsString()
  adminPassword!: string
}
