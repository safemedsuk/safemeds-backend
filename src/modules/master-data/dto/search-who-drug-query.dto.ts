import { IsOptional, IsString } from 'class-validator'

export class SearchWhoDrugQueryDto {
  @IsString()
  q!: string

  @IsOptional()
  @IsString()
  version?: string
}
