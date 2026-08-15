import { IsDateString, IsObject, IsOptional, IsString, IsUUID } from 'class-validator'

export class CreateFormSchemaDto {
  @IsOptional()
  @IsUUID()
  countryId?: string

  @IsUUID()
  reportTypeId!: string

  @IsObject()
  jsonSchema!: Record<string, unknown>

  @IsOptional()
  @IsString()
  officialFormCode?: string

  @IsDateString()
  effectiveFrom!: string
}
