import { IsOptional, IsString, MaxLength } from 'class-validator'

export class RecordChangeImplementationDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  implementationRecord?: string

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  verificationResult?: string
}
