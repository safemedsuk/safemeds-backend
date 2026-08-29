import { IsOptional, IsString, IsUUID } from 'class-validator'

export class InstantiateWorkflowDto {
  @IsString()
  recordType!: string

  @IsUUID()
  recordId!: string

  @IsOptional()
  @IsUUID()
  countryId?: string
}
