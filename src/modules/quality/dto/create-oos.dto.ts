import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export class CreateOosDto {
  @IsUUID()
  batchId!: string

  @IsUUID()
  specificationId!: string

  @IsUUID()
  parameterId!: string

  @MinLength(1)
  @MaxLength(500)
  @IsString()
  testResult!: string
}
