import { IsString, Length } from 'class-validator'

export class MfaVerifySetupDto {
  @IsString()
  @Length(6, 6)
  code!: string
}
