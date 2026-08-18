import { MeddraLevel } from '@prisma/client'
import { IsEnum, IsOptional, IsString } from 'class-validator'

export class SearchMeddraQueryDto {
  @IsString()
  q!: string

  @IsOptional()
  @IsString()
  version?: string

  @IsOptional()
  @IsEnum(MeddraLevel)
  level?: MeddraLevel
}
