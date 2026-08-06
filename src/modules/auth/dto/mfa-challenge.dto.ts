import { IsOptional, IsString, Length } from 'class-validator'

export class MfaChallengeDto {
  @IsString()
  mfaPendingToken!: string

  @IsOptional()
  @Length(6, 6)
  code?: string

  @IsOptional()
  @IsString()
  recoveryCode?: string
}
