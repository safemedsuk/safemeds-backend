import { IsDateString, IsString, IsUUID } from 'class-validator'

export class CreateSeriousnessDefinitionDto {
  @IsUUID()
  authorityId!: string

  @IsString()
  criterionKey!: string

  @IsString()
  label!: string

  @IsDateString()
  effectiveFrom!: string
}
