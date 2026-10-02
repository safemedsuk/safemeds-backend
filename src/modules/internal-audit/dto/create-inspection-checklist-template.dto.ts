import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, MinLength } from 'class-validator'

export class CreateInspectionChecklistTemplateDto {
  @IsUUID('7')
  authorityId!: string

  @IsString()
  @MinLength(1)
  sectionKey!: string

  @IsString()
  @MinLength(1)
  title!: string

  @IsOptional()
  @IsString()
  description?: string

  @IsOptional()
  @IsString()
  mappedRecordType?: string

  @IsOptional()
  @IsString()
  guidelineReference?: string

  @IsOptional()
  @IsInt()
  sortOrder?: number

  @IsOptional()
  @IsBoolean()
  unverified?: boolean
}
