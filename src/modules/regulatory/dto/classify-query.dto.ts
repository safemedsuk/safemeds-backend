import { IsOptional, IsString, IsUUID } from 'class-validator'

export class ClassifyQueryDto {
  @IsUUID()
  authorityId!: string

  @IsString()
  productClass!: string

  @IsOptional()
  @IsString()
  route?: string
}
