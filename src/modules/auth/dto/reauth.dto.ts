import { IsOptional, IsString, Length } from 'class-validator'

export class ReauthDto {
  @IsString()
  password!: string

  @IsOptional()
  @Length(6, 6)
  mfaCode?: string
}
