import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator'

export class UpsertWasteDisposalMethodDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  methodKey!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number

  @IsOptional()
  @IsBoolean()
  active?: boolean
}
