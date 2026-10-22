import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'

export class DocumentTypeNumberingDto {
  @IsString()
  @MaxLength(50)
  documentType!: string

  /** Blank or null = use the default initials derived from the type. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  initials?: string | null

  /** Null = inherit the company's token order. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  tokenOrder?: string[] | null

  /** Null = inherit the company's separator. */
  @IsOptional()
  @IsString()
  @MaxLength(1)
  separator?: string | null
}

export class SaveDocumentNumberingDto {
  @IsString()
  @MaxLength(10)
  companyInitials!: string

  @IsArray()
  @ArrayMaxSize(4)
  tokenOrder!: string[]

  @IsString()
  @MaxLength(1)
  separator!: string

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DocumentTypeNumberingDto)
  types?: DocumentTypeNumberingDto[]
}
