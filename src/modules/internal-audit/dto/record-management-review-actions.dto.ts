import { Type } from 'class-transformer'
import { IsArray, IsBoolean, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator'

export class ManagementReviewActionDto {
  @IsString()
  @MinLength(1)
  description!: string

  @IsOptional()
  @IsString()
  ownerUserId?: string

  /** When true, this action also opens a real CAPA via `CapaService.createFrom('management_review', ...)`. */
  @IsOptional()
  @IsBoolean()
  openCapa?: boolean

  @IsOptional()
  @IsString()
  rootCauseCategory?: string
}

export class RecordManagementReviewActionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManagementReviewActionDto)
  actions!: ManagementReviewActionDto[]
}
